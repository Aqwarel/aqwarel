// ============================================================
//  db.js — Connexion MySQL pour lexpert
//  Stack : Node.js + Express + mysql2
// ============================================================
'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  waitForConnections:    true,
  connectionLimit:       10,
  queueLimit:            0,
  enableKeepAlive:       true,
  keepAliveInitialDelay: 0,

  timezone:           '+00:00',
  charset:            'utf8mb4',
  multipleStatements: false,
  dateStrings:        false,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log(`✅  MySQL connecté — ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    conn.release();
  } catch (err) {
    console.error('❌  Erreur connexion MySQL :', err.message);
    process.exit(1);
  }
}

const db = {
  pool,
  testConnection,

  async query(sql, params = []) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (err) {
      console.error('DB query error:', err.message, '| SQL:', sql);
      throw err;
    }
  },

  async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  },

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

  async insert(table, data) {
    const cols         = Object.keys(data).map(k => `\`${k}\``).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const vals         = Object.values(data);
    const [res] = await pool.execute(
      `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
      vals
    );
    return res.insertId;
  },

  async update(table, data, where, whereVals = []) {
    const set  = Object.keys(data).map(k => `\`${k}\` = ?`).join(', ');
    const vals = [...Object.values(data), ...whereVals];
    const [res] = await pool.execute(
      `UPDATE \`${table}\` SET ${set} WHERE ${where}`,
      vals
    );
    return res.affectedRows;
  },

  async close() {
    await pool.end();
  },
};

module.exports = db;
