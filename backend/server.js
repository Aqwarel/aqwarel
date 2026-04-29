// ============================================================
//  server.js — Point d'entrée principal lexpert
//  Stack : Node.js + Express + MySQL (Laragon / Hostinger)
// ============================================================
'use strict';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { testConnection } = require('./config/db');

testConnection();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Sécurité
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL || '*' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ── Parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Fichiers statiques (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes API
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', version: process.env.npm_package_version || '1.0.0' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ── Clients
app.get('/api/clients', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT c.*, COALESCE(SUM(
        CASE WHEN cr.type='ajout' AND cr.is_cancelled=0 THEN cr.amount
             WHEN cr.type IN ('utilisation','remboursement') AND cr.is_cancelled=0 THEN -cr.amount
             ELSE 0 END), 0) AS current_balance
       FROM clients c
       LEFT JOIN credits cr ON cr.client_id = c.id
       WHERE c.is_active = 1
       GROUP BY c.id ORDER BY c.display_id`
    );
    res.json({ success: true, data: rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { first_name, last_name, email, phone } = req.body;
    if (!first_name?.trim()) return res.status(400).json({ success: false, message: 'Prénom obligatoire.' });
    const row = await db.queryOne('SELECT COALESCE(MAX(display_id),0)+1 AS next_id FROM clients');
    const id  = await db.insert('clients', { display_id: row.next_id, first_name: first_name.trim(), last_name: last_name?.trim()||null, email: email?.trim()||null, phone: phone?.trim()||null });
    res.status(201).json({ success: true, data: { id, display_id: row.next_id } });
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Email déjà utilisé.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Crédits
app.get('/api/credits', async (req, res) => {
  try {
    const { client_id, type, limit = 100, offset = 0 } = req.query;
    let sql = `SELECT cr.*, CONCAT(c.first_name,' ',COALESCE(c.last_name,'')) AS client_name,
               c.display_id AS client_display_id, pm.label AS method_label
               FROM credits cr
               LEFT JOIN clients c ON c.id=cr.client_id
               LEFT JOIN payment_methods pm ON pm.id=cr.payment_method_id
               WHERE cr.is_cancelled=0`;
    const params = [];
    if (client_id) { sql += ' AND cr.client_id=?'; params.push(+client_id); }
    if (type)      { sql += ' AND cr.type=?'; params.push(type); }
    sql += ' ORDER BY cr.operation_date DESC, cr.id DESC LIMIT ? OFFSET ?';
    params.push(+limit, +offset);
    const rows = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/credits', async (req, res) => {
  try {
    const { client_id, payment_method_id, amount, operation_date, note, type } = req.body;
    if (!client_id || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Paramètres invalides.' });
    const result = await db.transaction(async (conn) => {
      const [[{ balance }]] = await conn.execute(
        `SELECT COALESCE(SUM(CASE WHEN type='ajout' THEN amount WHEN type IN ('utilisation','remboursement') THEN -amount ELSE 0 END),0) AS balance FROM credits WHERE client_id=? AND is_cancelled=0 FOR UPDATE`,
        [+client_id]
      );
      const bal = parseFloat(balance);
      const amt = parseFloat(amount);
      const newBal = type === 'ajout' ? bal + amt : bal - amt;
      if (newBal < 0 && type !== 'ajout') throw new Error('INSUFFICIENT_BALANCE');
      const [ins] = await conn.execute(
        `INSERT INTO credits (client_id,type,payment_method_id,amount,balance_before,balance_after,operation_date,note) VALUES (?,?,?,?,?,?,?,?)`,
        [+client_id, type||'ajout', payment_method_id||null, amt, bal, newBal, operation_date||new Date().toISOString().slice(0,10), note||null]
      );
      return { insertId: ins.insertId, balanceBefore: bal, balanceAfter: newBal };
    });
    res.status(201).json({ success: true, data: result });
  } catch(e) {
    if (e.message === 'INSUFFICIENT_BALANCE') return res.status(400).json({ success: false, message: 'Solde insuffisant.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Paramètres
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await db.query('SELECT setting_key, value, type FROM app_settings');
    const obj  = {}; rows.forEach(r => obj[r.setting_key] = r.value);
    res.json({ success: true, data: obj });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      const exists = await db.queryOne('SELECT id FROM app_settings WHERE setting_key=?', [key]);
      if (exists) await db.update('app_settings', { value: String(value) }, 'setting_key=?', [key]);
    }
    res.json({ success: true, message: 'Paramètres sauvegardés.' });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Stats globales
app.get('/api/stats', async (req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM v_global_stats');
    res.json({ success: true, data: row });
  } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Démarrage
app.listen(PORT, () => {
  console.log(`\n🚀  lexpert API démarrée — http://localhost:${PORT}`);
  console.log(`📦  Environnement : ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️   Base de données : ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);
});

module.exports = app;
