// ============================================================
//  db.js — Connexion MySQL pour lexpert
//  Stack : Node.js + Express + mysql2
//  Hostinger MySQL 8.0+
// ============================================================

'use strict';

const mysql = require('mysql2/promise');

// ── Chargement des variables d'environnement
require('dotenv').config();

// ── Configuration du pool de connexions
const poolConfig = {
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  database:           process.env.DB_NAME,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,

  // Pool settings
  waitForConnections:  true,
  connectionLimit:     10,          // max connexions simultanées
  queueLimit:          0,           // 0 = illimité en file d'attente
  enableKeepAlive:     true,
  keepAliveInitialDelay: 0,

  // Sécurité & performance
  timezone:            '+00:00',    // UTC systématiquement
  charset:             'utf8mb4',
  multipleStatements:  false,       // IMPORTANT : prévient injections SQL multi-requêtes
  dateStrings:         false,

  // SSL Hostinger (recommandé en production)
  // ssl: { rejectUnauthorized: true },
};

// ── Création du pool
const pool = mysql.createPool(poolConfig);

// ── Test de connexion au démarrage
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅  MySQL connecté — ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    conn.release();
  } catch (err) {
    console.error('❌  Erreur connexion MySQL :', err.message);
    process.exit(1);  // Arrêt si impossible de se connecter
  }
})();

// ── Méthodes utilitaires exposées
const db = {

  /**
   * Exécute une requête paramétrée (SELECT, INSERT, UPDATE, DELETE)
   * @param {string} sql   - Requête avec placeholders ?
   * @param {Array}  params - Tableau de valeurs
   * @returns {Promise<Array>} rows
   */
  async query(sql, params = []) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (err) {
      console.error('DB query error:', err.message, '| SQL:', sql);
      throw err;
    }
  },

  /**
   * Récupère une seule ligne
   */
  async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  },

  /**
   * Exécute plusieurs requêtes dans une transaction
   * @param {Function} callback - Reçoit une connexion `conn`
   */
  async transaction(callback) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const result = await callback(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * INSERT rapide à partir d'un objet
   * @param {string} table
   * @param {Object} data  - { col: val, … }
   * @returns {number} insertId
   */
  async insert(table, data) {
    const cols   = Object.keys(data).map(k => `\`${k}\``).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const vals   = Object.values(data);
    const [res]  = await pool.execute(
      `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
      vals
    );
    return res.insertId;
  },

  /**
   * UPDATE rapide à partir d'un objet
   * @param {string} table
   * @param {Object} data      - Colonnes à mettre à jour
   * @param {string} where     - Condition WHERE (ex: 'id = ?')
   * @param {Array}  whereVals - Valeurs pour la condition
   * @returns {number} affectedRows
   */
  async update(table, data, where, whereVals = []) {
    const set   = Object.keys(data).map(k => `\`${k}\` = ?`).join(', ');
    const vals  = [...Object.values(data), ...whereVals];
    const [res] = await pool.execute(
      `UPDATE \`${table}\` SET ${set} WHERE ${where}`,
      vals
    );
    return res.affectedRows;
  },

  /**
   * Ferme proprement le pool (utile en tests)
   */
  async close() {
    await pool.end();
  },
};

module.exports = db;
