-- ============================================================
--  BASE DE DONNEES : lexpert - Gestion des Credits Clients
--  Hebergement     : Hostinger (MariaDB / MySQL 8.0+)
--  Version         : 1.1.0
--  NOTE : Importer APRES avoir selectionne votre base dans phpMyAdmin
--         Ne pas inclure CREATE DATABASE ni USE sur Hostinger
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;
SET time_zone = '+00:00';


-- ============================================================
--  1. ROLES
-- ============================================================
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50)   NOT NULL,
  `label`       VARCHAR(100)  NOT NULL,
  `description` TEXT          DEFAULT NULL,
  `is_active`   TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_name` (`name`),
  INDEX `idx_roles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Roles utilisateurs de application';

INSERT INTO `roles` (`name`, `label`, `description`) VALUES
  ('admin',   'Administrateur', 'Acces complet a toutes les fonctionnalites'),
  ('manager', 'Gestionnaire',   'Peut creer et modifier credits et clients'),
  ('cashier', 'Caissier',       'Peut ajouter des credits et des ventes uniquement'),
  ('viewer',  'Lecteur',        'Lecture seule');


-- ============================================================
--  2. PERMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS `permissions` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(100)  NOT NULL,
  `module`      VARCHAR(50)   NOT NULL,
  `action`      VARCHAR(50)   NOT NULL,
  `description` TEXT          DEFAULT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_name` (`name`),
  UNIQUE KEY `uq_perm_module_action` (`module`, `action`),
  INDEX `idx_permissions_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Permissions disponibles dans application';

INSERT INTO `permissions` (`name`, `module`, `action`) VALUES
  ('clients.create',  'clients',  'create'),
  ('clients.read',    'clients',  'read'),
  ('clients.update',  'clients',  'update'),
  ('clients.delete',  'clients',  'delete'),
  ('credits.create',  'credits',  'create'),
  ('credits.read',    'credits',  'read'),
  ('credits.update',  'credits',  'update'),
  ('credits.delete',  'credits',  'delete'),
  ('sales.create',    'sales',    'create'),
  ('sales.read',      'sales',    'read'),
  ('reports.read',    'reports',  'read'),
  ('settings.update', 'settings', 'update');


-- ============================================================
--  3. ROLES - PERMISSIONS (table pivot)
-- ============================================================
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id`       INT UNSIGNED NOT NULL,
  `permission_id` INT UNSIGNED NOT NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`, `permission_id`),
  CONSTRAINT `fk_rp_role`       FOREIGN KEY (`role_id`)       REFERENCES `roles`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Association roles et permissions';


-- ============================================================
--  4. UTILISATEURS (back-office)
-- ============================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `role_id`              INT UNSIGNED  NOT NULL DEFAULT 1,
  `first_name`           VARCHAR(80)   NOT NULL,
  `last_name`            VARCHAR(80)   NOT NULL,
  `email`                VARCHAR(191)  NOT NULL,
  `password_hash`        VARCHAR(255)  NOT NULL,
  `phone`                VARCHAR(30)   DEFAULT NULL,
  `avatar_url`           VARCHAR(500)  DEFAULT NULL,
  `is_active`            TINYINT(1)    NOT NULL DEFAULT 1,
  `email_verified_at`    DATETIME      DEFAULT NULL,
  `last_login_at`        DATETIME      DEFAULT NULL,
  `password_reset_token` VARCHAR(100)  DEFAULT NULL,
  `password_reset_at`    DATETIME      DEFAULT NULL,
  `created_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  INDEX `idx_users_email`  (`email`),
  INDEX `idx_users_role`   (`role_id`),
  INDEX `idx_users_active` (`is_active`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Comptes utilisateurs du back-office';


-- ============================================================
--  5. CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS `clients` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `display_id`  INT UNSIGNED  NOT NULL,
  `first_name`  VARCHAR(80)   NOT NULL,
  `last_name`   VARCHAR(80)   DEFAULT NULL,
  `email`       VARCHAR(191)  DEFAULT NULL,
  `phone`       VARCHAR(30)   DEFAULT NULL,
  `address`     TEXT          DEFAULT NULL,
  `city`        VARCHAR(80)   DEFAULT NULL,
  `notes`       TEXT          DEFAULT NULL,
  `is_active`   TINYINT(1)    NOT NULL DEFAULT 1,
  `created_by`  INT UNSIGNED  DEFAULT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clients_display_id` (`display_id`),
  UNIQUE KEY `uq_clients_email`      (`email`),
  INDEX `idx_clients_display_id`     (`display_id`),
  INDEX `idx_clients_email`          (`email`),
  INDEX `idx_clients_active`         (`is_active`),
  CONSTRAINT `fk_clients_user` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Clients de entreprise';


-- ============================================================
--  6. METHODES DE PAIEMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id`        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`      VARCHAR(50)   NOT NULL,
  `label`     VARCHAR(100)  NOT NULL,
  `is_active` TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payment_methods_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Modes de paiement disponibles';

INSERT INTO `payment_methods` (`name`, `label`) VALUES
  ('especes',  'Especes'),
  ('carte',    'Carte bancaire'),
  ('virement', 'Virement bancaire'),
  ('cheque',   'Cheque');


-- ============================================================
--  7. CREDITS (transactions clients)
-- ============================================================
CREATE TABLE IF NOT EXISTS `credits` (
  `id`                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `client_id`         INT UNSIGNED    NOT NULL,
  `user_id`           INT UNSIGNED    DEFAULT NULL,
  `type`              ENUM('ajout','utilisation','remboursement') NOT NULL,
  `payment_method_id` INT UNSIGNED    DEFAULT NULL,
  `amount`            DECIMAL(12,2)   NOT NULL,
  `balance_before`    DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `balance_after`     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `operation_date`    DATE            NOT NULL,
  `note`              TEXT            DEFAULT NULL,
  `reference`         VARCHAR(60)     DEFAULT NULL,
  `is_cancelled`      TINYINT(1)      NOT NULL DEFAULT 0,
  `cancelled_at`      DATETIME        DEFAULT NULL,
  `cancelled_by`      INT UNSIGNED    DEFAULT NULL,
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_credits_client`    (`client_id`),
  INDEX `idx_credits_type`      (`type`),
  INDEX `idx_credits_date`      (`operation_date`),
  INDEX `idx_credits_user`      (`user_id`),
  INDEX `idx_credits_cancelled` (`is_cancelled`),
  CONSTRAINT `fk_credits_client` FOREIGN KEY (`client_id`)         REFERENCES `clients`(`id`)         ON DELETE RESTRICT,
  CONSTRAINT `fk_credits_user`   FOREIGN KEY (`user_id`)           REFERENCES `users`(`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_credits_method` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_credits_cancel` FOREIGN KEY (`cancelled_by`)      REFERENCES `users`(`id`)           ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Toutes les transactions de credits clients';


-- ============================================================
--  8. VENTES
-- ============================================================
CREATE TABLE IF NOT EXISTS `sales` (
  `id`           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `client_id`    INT UNSIGNED    NOT NULL,
  `user_id`      INT UNSIGNED    DEFAULT NULL,
  `credit_id`    INT UNSIGNED    DEFAULT NULL,
  `sale_number`  VARCHAR(30)     NOT NULL,
  `total_amount` DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `credit_used`  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `amount_paid`  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  `sale_date`    DATE            NOT NULL,
  `note`         TEXT            DEFAULT NULL,
  `status`       ENUM('pending','completed','cancelled','refunded') NOT NULL DEFAULT 'completed',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sales_number` (`sale_number`),
  INDEX `idx_sales_client` (`client_id`),
  INDEX `idx_sales_date`   (`sale_date`),
  INDEX `idx_sales_status` (`status`),
  INDEX `idx_sales_user`   (`user_id`),
  CONSTRAINT `fk_sales_client` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_sales_user`   FOREIGN KEY (`user_id`)   REFERENCES `users`(`id`)   ON DELETE SET NULL,
  CONSTRAINT `fk_sales_credit` FOREIGN KEY (`credit_id`) REFERENCES `credits`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Historique des ventes';


-- ============================================================
--  9. PAIEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id`                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `sale_id`           INT UNSIGNED    DEFAULT NULL,
  `client_id`         INT UNSIGNED    NOT NULL,
  `user_id`           INT UNSIGNED    DEFAULT NULL,
  `payment_method_id` INT UNSIGNED    DEFAULT NULL,
  `amount`            DECIMAL(12,2)   NOT NULL,
  `payment_date`      DATE            NOT NULL,
  `reference`         VARCHAR(60)     DEFAULT NULL,
  `note`              TEXT            DEFAULT NULL,
  `status`            ENUM('pending','validated','failed','refunded') NOT NULL DEFAULT 'validated',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_payments_client` (`client_id`),
  INDEX `idx_payments_sale`   (`sale_id`),
  INDEX `idx_payments_date`   (`payment_date`),
  INDEX `idx_payments_status` (`status`),
  CONSTRAINT `fk_payments_client` FOREIGN KEY (`client_id`)         REFERENCES `clients`(`id`)         ON DELETE RESTRICT,
  CONSTRAINT `fk_payments_sale`   FOREIGN KEY (`sale_id`)           REFERENCES `sales`(`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_payments_user`   FOREIGN KEY (`user_id`)           REFERENCES `users`(`id`)           ON DELETE SET NULL,
  CONSTRAINT `fk_payments_method` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Paiements effectues';


-- ============================================================
--  10. PARAMETRES APPLICATION
--  Note: colonne nommee setting_key (evite le mot reserve KEY)
--        colonne nommee grp (evite le mot reserve GROUP)
-- ============================================================
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(100)  NOT NULL,
  `value`       TEXT          DEFAULT NULL,
  `type`        ENUM('string','boolean','number','json','url') NOT NULL DEFAULT 'string',
  `grp`         VARCHAR(50)   NOT NULL DEFAULT 'general',
  `label`       VARCHAR(150)  DEFAULT NULL,
  `description` TEXT          DEFAULT NULL,
  `is_public`   TINYINT(1)    NOT NULL DEFAULT 0,
  `updated_by`  INT UNSIGNED  DEFAULT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settings_key` (`setting_key`),
  INDEX `idx_settings_key` (`setting_key`),
  INDEX `idx_settings_grp` (`grp`),
  CONSTRAINT `fk_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Parametres de application';

INSERT INTO `app_settings` (`setting_key`, `value`, `type`, `grp`, `label`, `is_public`) VALUES
  ('company_name',     'lexpert', 'string',  'general',    'Nom de entreprise',   1),
  ('company_address',  '',        'string',  'general',    'Adresse',             1),
  ('company_phone_1',  '',        'string',  'general',    'Telephone 1',         1),
  ('company_phone_2',  '',        'string',  'general',    'Telephone 2',         1),
  ('credits_enabled',  '1',       'boolean', 'credits',    'Credits actives',     0),
  ('tracking_mode',    'detail',  'string',  'credits',    'Mode de suivi',       0),
  ('logo_url',         '',        'url',     'appearance', 'URL du logo',         1),
  ('currency',         'MAD',     'string',  'general',    'Devise',              1),
  ('app_version',      '1.0.0',   'string',  'system',     'Version application', 0),
  ('maintenance_mode', '0',       'boolean', 'system',     'Mode maintenance',    0);


-- ============================================================
--  11. JOURNAUX D ACTIVITE
--  Note: old_values et new_values en TEXT (JSON non garanti sur MariaDB ancien)
-- ============================================================
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED    DEFAULT NULL,
  `action`      VARCHAR(100)    NOT NULL,
  `module`      VARCHAR(50)     NOT NULL,
  `record_id`   INT UNSIGNED    DEFAULT NULL,
  `record_type` VARCHAR(50)     DEFAULT NULL,
  `old_values`  TEXT            DEFAULT NULL,
  `new_values`  TEXT            DEFAULT NULL,
  `ip_address`  VARCHAR(45)     DEFAULT NULL,
  `user_agent`  VARCHAR(255)    DEFAULT NULL,
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_logs_user`   (`user_id`),
  INDEX `idx_logs_action` (`action`),
  INDEX `idx_logs_module` (`module`),
  INDEX `idx_logs_date`   (`created_at`),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Journaux activite de application';


-- ============================================================
--  12. CONTACTS / MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS `contact_messages` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `sender_name`  VARCHAR(120)  NOT NULL,
  `sender_email` VARCHAR(191)  NOT NULL,
  `sender_phone` VARCHAR(30)   DEFAULT NULL,
  `subject`      VARCHAR(200)  NOT NULL,
  `body`         TEXT          NOT NULL,
  `status`       ENUM('unread','read','replied','archived') NOT NULL DEFAULT 'unread',
  `replied_by`   INT UNSIGNED  DEFAULT NULL,
  `replied_at`   DATETIME      DEFAULT NULL,
  `ip_address`   VARCHAR(45)   DEFAULT NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_contact_status` (`status`),
  INDEX `idx_contact_date`   (`created_at`),
  CONSTRAINT `fk_contact_user` FOREIGN KEY (`replied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Messages entrants via formulaire de contact';


-- ============================================================
--  13. SESSIONS UTILISATEURS
-- ============================================================
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id`          VARCHAR(128)  NOT NULL,
  `user_id`     INT UNSIGNED  NOT NULL,
  `ip_address`  VARCHAR(45)   DEFAULT NULL,
  `user_agent`  VARCHAR(255)  DEFAULT NULL,
  `payload`     TEXT          DEFAULT NULL,
  `last_active` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`  DATETIME      NOT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sessions_user`    (`user_id`),
  INDEX `idx_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sessions actives des utilisateurs';


-- ============================================================
--  VUE : soldes clients en temps reel
-- ============================================================
CREATE OR REPLACE VIEW `v_client_balances` AS
SELECT
  c.id,
  c.display_id,
  CONCAT(c.first_name, ' ', COALESCE(c.last_name, '')) AS full_name,
  c.email,
  c.phone,
  c.is_active,
  COALESCE(SUM(CASE WHEN cr.type = 'ajout'         AND cr.is_cancelled = 0 THEN cr.amount ELSE 0 END), 0) AS total_added,
  COALESCE(SUM(CASE WHEN cr.type = 'utilisation'   AND cr.is_cancelled = 0 THEN cr.amount ELSE 0 END), 0) AS total_used,
  COALESCE(SUM(CASE WHEN cr.type = 'remboursement' AND cr.is_cancelled = 0 THEN cr.amount ELSE 0 END), 0) AS total_refunded,
  COALESCE(SUM(
    CASE WHEN cr.is_cancelled = 0 THEN
      CASE cr.type
        WHEN 'ajout'         THEN  cr.amount
        WHEN 'utilisation'   THEN -cr.amount
        WHEN 'remboursement' THEN -cr.amount
        ELSE 0
      END
    ELSE 0 END
  ), 0) AS current_balance
FROM `clients` c
LEFT JOIN `credits` cr ON cr.client_id = c.id
GROUP BY c.id, c.display_id, c.first_name, c.last_name, c.email, c.phone, c.is_active;


-- ============================================================
--  VUE : statistiques globales
-- ============================================================
CREATE OR REPLACE VIEW `v_global_stats` AS
SELECT
  (SELECT COUNT(*)                 FROM `clients` WHERE is_active = 1)                           AS active_clients,
  (SELECT COALESCE(SUM(amount), 0) FROM `credits` WHERE type = 'ajout'         AND is_cancelled = 0) AS total_added,
  (SELECT COALESCE(SUM(amount), 0) FROM `credits` WHERE type = 'utilisation'   AND is_cancelled = 0) AS total_used,
  (SELECT COALESCE(SUM(amount), 0) FROM `credits` WHERE type = 'remboursement' AND is_cancelled = 0) AS total_refunded,
  (SELECT COUNT(*)                 FROM `credits` WHERE is_cancelled = 0)                        AS total_operations,
  (SELECT COUNT(*)                 FROM `sales`   WHERE status = 'completed')                    AS completed_sales;


-- ============================================================
--  REACTIVER LES CONTRAINTES
-- ============================================================
SET FOREIGN_KEY_CHECKS = 1;

-- FIN DU SCRIPT
