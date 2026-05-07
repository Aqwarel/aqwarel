-- ============================================================
--  MIGRATION 003 : Passage au modele "credit a echeances"
--  - Renomme l'ancienne table credits (balance prepayee) -> credit_balance_ops
--  - Cree la nouvelle table credits (pret a echeances)
--  - Cree la table echeances (installments)
--  - Ajoute CIN aux clients
--  - Ajoute echeance_id a payments
--  - Recree les vues
--  A executer une seule fois sur Laragon ET sur Hostinger
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
--  1. CIN sur clients (idempotent via procedure)
-- ============================================================
DROP PROCEDURE IF EXISTS `_add_cin_to_clients`;
DELIMITER $$
CREATE PROCEDURE `_add_cin_to_clients`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'cin'
  ) THEN
    ALTER TABLE `clients` ADD COLUMN `cin` VARCHAR(20) DEFAULT NULL AFTER `phone`;
    ALTER TABLE `clients` ADD INDEX `idx_clients_cin` (`cin`);
  END IF;
END$$
DELIMITER ;
CALL `_add_cin_to_clients`();
DROP PROCEDURE `_add_cin_to_clients`;

-- ============================================================
--  2. Sauvegarde de l'ancienne table credits
-- ============================================================
-- Supprime les vues qui dependent de credits (on les recree apres)
DROP VIEW IF EXISTS `v_client_balances`;
DROP VIEW IF EXISTS `v_global_stats`;

-- Renomme la table existante (preservation des donnees historiques)
RENAME TABLE `credits` TO `credit_balance_ops`;

-- ============================================================
--  3. Nouvelle table CREDITS = pret a echeances
-- ============================================================
CREATE TABLE IF NOT EXISTS `credits` (
  `id`                  INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `client_id`           INT UNSIGNED   NOT NULL,
  `user_id`             INT UNSIGNED   DEFAULT NULL,
  `product_name`        VARCHAR(191)   NOT NULL,
  `total_price`         DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `down_payment`        DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `remaining`           DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `num_installments`    INT UNSIGNED   NOT NULL DEFAULT 1,
  `installment_amount`  DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `start_date`          DATE           NOT NULL,
  `status`              ENUM('en_cours','paye','retard','annule') NOT NULL DEFAULT 'en_cours',
  `note`                TEXT           DEFAULT NULL,
  `created_at`          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_credits_client`  (`client_id`),
  INDEX `idx_credits_status`  (`status`),
  INDEX `idx_credits_date`    (`start_date`),
  INDEX `idx_credits_user`    (`user_id`),
  CONSTRAINT `fk_credits_client_v2` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_credits_user_v2`   FOREIGN KEY (`user_id`)   REFERENCES `users`(`id`)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Credits a echeances (prets pour achat produit)';

-- ============================================================
--  4. ECHEANCES (installments)
-- ============================================================
CREATE TABLE IF NOT EXISTS `echeances` (
  `id`                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `credit_id`         INT UNSIGNED   NOT NULL,
  `installment_no`    INT UNSIGNED   NOT NULL,
  `due_date`          DATE           NOT NULL,
  `amount`            DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `paid_amount`       DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  `status`            ENUM('a_payer','payee','retard','partielle') NOT NULL DEFAULT 'a_payer',
  `paid_at`           DATETIME       DEFAULT NULL,
  `payment_method_id` INT UNSIGNED   DEFAULT NULL,
  `note`              TEXT           DEFAULT NULL,
  `created_at`        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_echeances_credit_no` (`credit_id`, `installment_no`),
  INDEX `idx_echeances_credit`   (`credit_id`),
  INDEX `idx_echeances_due_date` (`due_date`),
  INDEX `idx_echeances_status`   (`status`),
  CONSTRAINT `fk_echeances_credit` FOREIGN KEY (`credit_id`)         REFERENCES `credits`(`id`)         ON DELETE CASCADE,
  CONSTRAINT `fk_echeances_method` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Echeances de paiement liees a un credit';

-- ============================================================
--  5. PAYMENTS : etend pour pointer vers une echeance (idempotent)
-- ============================================================
DROP PROCEDURE IF EXISTS `_add_echeance_to_payments`;
DELIMITER $$
CREATE PROCEDURE `_add_echeance_to_payments`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'echeance_id'
  ) THEN
    ALTER TABLE `payments` ADD COLUMN `echeance_id` INT UNSIGNED DEFAULT NULL AFTER `client_id`;
    ALTER TABLE `payments` ADD INDEX `idx_payments_echeance` (`echeance_id`);
    ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_echeance`
      FOREIGN KEY (`echeance_id`) REFERENCES `echeances`(`id`) ON DELETE SET NULL;
  END IF;
END$$
DELIMITER ;
CALL `_add_echeance_to_payments`();
DROP PROCEDURE `_add_echeance_to_payments`;

-- ============================================================
--  6. Permissions echeances
-- ============================================================
INSERT IGNORE INTO `permissions` (`name`, `module`, `action`) VALUES
  ('echeances.read',   'echeances', 'read'),
  ('echeances.update', 'echeances', 'update');

-- ============================================================
--  7. Vues utiles
-- ============================================================

-- Resume par credit : nb echeances totales, payees, en retard, montant restant
CREATE OR REPLACE VIEW `v_credits_summary` AS
SELECT
  c.id,
  c.client_id,
  c.product_name,
  c.total_price,
  c.down_payment,
  c.num_installments,
  c.installment_amount,
  c.start_date,
  c.status,
  c.created_at,
  COALESCE(SUM(e.paid_amount), 0) AS total_paid,
  c.total_price - c.down_payment - COALESCE(SUM(e.paid_amount), 0) AS total_remaining,
  COUNT(CASE WHEN e.status = 'payee'    THEN 1 END) AS echeances_payees,
  COUNT(CASE WHEN e.status = 'retard'   THEN 1 END) AS echeances_retard,
  COUNT(CASE WHEN e.status = 'a_payer'  THEN 1 END) AS echeances_a_payer,
  MIN(CASE WHEN e.status IN ('a_payer','retard','partielle') THEN e.due_date END) AS next_due_date
FROM `credits` c
LEFT JOIN `echeances` e ON e.credit_id = c.id
GROUP BY c.id;

-- Statistiques globales (nouveau modele)
CREATE OR REPLACE VIEW `v_global_stats` AS
SELECT
  (SELECT COUNT(*) FROM `clients` WHERE is_active = 1)                                            AS active_clients,
  (SELECT COUNT(*) FROM `credits` WHERE status = 'en_cours')                                      AS credits_en_cours,
  (SELECT COUNT(*) FROM `credits` WHERE status = 'retard')                                        AS credits_retard,
  (SELECT COUNT(*) FROM `credits` WHERE status = 'paye')                                          AS credits_payes,
  (SELECT COALESCE(SUM(total_price), 0)                FROM `credits` WHERE status <> 'annule')   AS total_credits,
  (SELECT COALESCE(SUM(down_payment + 0), 0)           FROM `credits` WHERE status <> 'annule')   AS total_down,
  (SELECT COALESCE(SUM(paid_amount), 0)                FROM `echeances`)                          AS total_paid_echeances,
  (SELECT COALESCE(SUM(amount - paid_amount), 0)       FROM `echeances` WHERE status <> 'payee')  AS total_remaining,
  (SELECT COUNT(*) FROM `echeances` WHERE status = 'retard')                                      AS echeances_en_retard;

SET FOREIGN_KEY_CHECKS = 1;

-- FIN
