-- ============================================================
--  MIGRATION 002 : Persistance du logo en base
--  A executer une seule fois sur Laragon ET sur Hostinger
--  via phpMyAdmin (onglet SQL) ou la console mysql
-- ============================================================

SET NAMES utf8mb4;

-- Elargir app_settings.value pour accepter le logo en base64
-- TEXT       -> 64 KB  (insuffisant)
-- MEDIUMTEXT -> 16 MB  (largement suffisant pour un logo)
ALTER TABLE `app_settings`
  MODIFY COLUMN `value` MEDIUMTEXT DEFAULT NULL;

-- Ajouter la cle logo_data si elle n'existe pas deja
INSERT IGNORE INTO `app_settings`
  (`setting_key`, `value`, `type`, `grp`, `label`, `is_public`)
VALUES
  ('logo_data', '', 'string', 'appearance', 'Logo (base64)', 1);

-- FIN
