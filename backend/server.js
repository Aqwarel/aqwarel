// ============================================================
//  server.js — Point d'entrée principal lexpert
//  Stack : Node.js + Express + MySQL (Laragon / Hostinger)
// ============================================================
'use strict';

require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');

const db          = require('./config/db');
const authRoutes  = require('./routes/auth.routes');
const authMw      = require('./middleware/auth');

db.testConnection();

const app    = express();
const PORT   = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Behind nginx in production — trust X-Forwarded-* so rate-limit and req.ip see real client IPs
if (isProd) app.set('trust proxy', 1);

// ── Sécurité
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — accepts a comma-separated list in APP_URL (e.g. https://aqwarel.com,https://www.aqwarel.com).
// In dev, falls back to "*" so Laragon on any port works.
const corsOrigins = process.env.APP_URL
  ? process.env.APP_URL.split(',').map(s => s.trim()).filter(Boolean)
  : '*';
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(compression());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));

// ── Parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Fichiers statiques (frontend)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Helper : résoudre un nom de mode de paiement (FR/lower) → id
const PM_MAP = {
  'especes': 'especes', 'espèces': 'especes', 'espece': 'especes',
  'carte': 'carte', 'carte bancaire': 'carte',
  'virement': 'virement', 'virement bancaire': 'virement',
  'cheque': 'cheque', 'chèque': 'cheque',
};
function normalizePmName(input) {
  if (!input) return null;
  const k = String(input).trim().toLowerCase();
  return PM_MAP[k] || null;
}
async function resolvePaymentMethodId(input) {
  const name = normalizePmName(input);
  if (!name) return null;
  const row = await db.queryOne('SELECT id FROM payment_methods WHERE name=?', [name]);
  return row?.id || null;
}

// ── Auth optionnelle (pour récupérer user_id sans bloquer)
function authOptional(req, _res, next) {
  const h = req.headers['authorization'];
  const token = h && h.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {}
  }
  next();
}

// ============================================================
//  AUTH
// ============================================================
app.use('/api/auth', authRoutes);

// GET /api/auth/me — vérifie le token et renvoie l'utilisateur
app.get('/api/auth/me', authMw, async (req, res) => {
  try {
    const user = await db.queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id=? AND u.is_active=1`,
      [req.user.id]
    );
    if (!user) return res.status(401).json({ success: false, message: 'Utilisateur introuvable.' });
    res.json({
      success: true,
      user: {
        id: user.id, email: user.email,
        firstName: user.first_name, lastName: user.last_name,
        role: user.role_name,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  HEALTH
// ============================================================
app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ success: true, status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ success: false, status: 'error', message: e.message });
  }
});

// ============================================================
//  CLIENTS
// ============================================================
app.get('/api/clients', authOptional, async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT c.*, COALESCE(SUM(
        CASE WHEN cr.is_cancelled=0 THEN
          CASE cr.type
            WHEN 'ajout'         THEN  cr.amount
            WHEN 'utilisation'   THEN -cr.amount
            WHEN 'remboursement' THEN -cr.amount
            ELSE 0 END
        ELSE 0 END), 0) AS current_balance
       FROM clients c
       LEFT JOIN credits cr ON cr.client_id = c.id
       WHERE c.is_active = 1
       GROUP BY c.id
       ORDER BY c.display_id`
    );
    res.json({ success: true, clients: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/clients', authOptional, async (req, res) => {
  try {
    const { first_name, last_name, email, phone } = req.body;
    if (!first_name?.trim())
      return res.status(400).json({ success: false, message: 'Prénom obligatoire.' });

    const row = await db.queryOne('SELECT COALESCE(MAX(display_id),0)+1 AS next_id FROM clients');
    const id  = await db.insert('clients', {
      display_id: row.next_id,
      first_name: first_name.trim(),
      last_name:  last_name?.trim() || null,
      email:      email?.trim() || null,
      phone:      phone?.trim() || null,
      created_by: req.user?.id || null,
    });
    res.status(201).json({ success: true, id, display_id: row.next_id });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Email déjà utilisé.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/clients/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { first_name, last_name, email, phone } = req.body;
    const data = {};
    if (first_name !== undefined) data.first_name = first_name?.trim() || null;
    if (last_name  !== undefined) data.last_name  = last_name?.trim() || null;
    if (email      !== undefined) data.email      = email?.trim() || null;
    if (phone      !== undefined) data.phone      = phone?.trim() || null;
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ à modifier.' });

    const aff = await db.update('clients', data, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Client introuvable.' });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, message: 'Email déjà utilisé.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/clients/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    // Soft delete : désactive le client + annule ses crédits
    await db.transaction(async (conn) => {
      await conn.execute('UPDATE clients SET is_active=0 WHERE id=?', [id]);
      await conn.execute(
        'UPDATE credits SET is_cancelled=1, cancelled_at=NOW() WHERE client_id=? AND is_cancelled=0',
        [id]
      );
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  CREDITS
// ============================================================
app.get('/api/credits', authOptional, async (req, res) => {
  try {
    const { client_id, type } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  ?? 1000, 10) || 1000, 5000);
    const offset = Math.max(parseInt(req.query.offset ?? 0, 10) || 0, 0);
    let sql = `SELECT cr.*,
                 CONCAT(c.first_name,' ',COALESCE(c.last_name,'')) AS client_name,
                 c.display_id AS client_display_id,
                 pm.name  AS payment_method,
                 pm.label AS payment_method_label,
                 CONCAT(u.first_name,' ',COALESCE(u.last_name,'')) AS operator_name
               FROM credits cr
               LEFT JOIN clients c          ON c.id = cr.client_id
               LEFT JOIN payment_methods pm ON pm.id = cr.payment_method_id
               LEFT JOIN users u            ON u.id = cr.user_id
               WHERE cr.is_cancelled=0`;
    const params = [];
    if (client_id) { sql += ' AND cr.client_id=?'; params.push(+client_id); }
    if (type)      { sql += ' AND cr.type=?';      params.push(type); }
    sql += ` ORDER BY cr.operation_date ASC, cr.id ASC LIMIT ${limit} OFFSET ${offset}`;
    const rows = await db.query(sql, params);
    res.json({ success: true, credits: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/credits', authOptional, async (req, res) => {
  try {
    const { client_id, payment_method, amount, operation_date, note, type } = req.body;
    if (!client_id || !amount || amount <= 0)
      return res.status(400).json({ success: false, message: 'Paramètres invalides.' });
    if (!['ajout','utilisation','remboursement'].includes(type))
      return res.status(400).json({ success: false, message: 'Type invalide.' });

    const pmId = await resolvePaymentMethodId(payment_method);

    const result = await db.transaction(async (conn) => {
      const [[bal]] = await conn.execute(
        `SELECT COALESCE(SUM(
           CASE WHEN type='ajout' THEN amount
                WHEN type IN ('utilisation','remboursement') THEN -amount
                ELSE 0 END), 0) AS balance
         FROM credits WHERE client_id=? AND is_cancelled=0 FOR UPDATE`,
        [+client_id]
      );
      const before = parseFloat(bal.balance);
      const amt    = parseFloat(amount);
      const after  = type === 'ajout' ? before + amt : before - amt;
      if (after < 0 && type !== 'ajout') throw new Error('INSUFFICIENT_BALANCE');

      const [ins] = await conn.execute(
        `INSERT INTO credits
           (client_id, user_id, type, payment_method_id, amount, balance_before, balance_after, operation_date, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          +client_id,
          req.user?.id || null,
          type,
          pmId,
          amt,
          before,
          after,
          operation_date || new Date().toISOString().slice(0,10),
          note || null,
        ]
      );
      return { id: ins.insertId, balance_before: before, balance_after: after };
    });
    res.status(201).json({ success: true, ...result });
  } catch (e) {
    if (e.message === 'INSUFFICIENT_BALANCE')
      return res.status(400).json({ success: false, message: 'Solde insuffisant.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/credits/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { client_id, type, payment_method, amount, note, operation_date } = req.body;
    const data = {};
    if (client_id      !== undefined) data.client_id = +client_id;
    if (type           !== undefined) data.type      = type;
    if (amount         !== undefined) data.amount    = parseFloat(amount);
    if (note           !== undefined) data.note      = note || null;
    if (operation_date !== undefined) data.operation_date = operation_date;
    if (payment_method !== undefined) data.payment_method_id = await resolvePaymentMethodId(payment_method);
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ à modifier.' });

    const aff = await db.update('credits', data, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Opération introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/credits/:id', authOptional, async (req, res) => {
  try {
    const id  = +req.params.id;
    const aff = await db.update(
      'credits',
      { is_cancelled: 1, cancelled_at: new Date(), cancelled_by: req.user?.id || null },
      'id=?', [id]
    );
    if (!aff) return res.status(404).json({ success: false, message: 'Opération introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  USERS (admin uniquement)
// ============================================================
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Accès refusé.' });
  next();
}

app.get('/api/users', authMw, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active,
              u.last_login_at, r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.id`
    );
    res.json({ success: true, users: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/users', authMw, requireAdmin, async (req, res) => {
  try {
    const { first_name, last_name, email, password, role } = req.body;
    if (!first_name || !email || !password)
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
    if (password.length < 8)
      return res.status(400).json({ success: false, message: 'Mot de passe trop court (8 min).' });

    const exists = await db.queryOne('SELECT id FROM users WHERE email=?', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ success: false, message: 'Email déjà utilisé.' });

    const roleRow = await db.queryOne('SELECT id FROM roles WHERE name=?', [role || 'viewer']);
    const hash    = await bcrypt.hash(password, 12);
    const id      = await db.insert('users', {
      first_name: first_name.trim(),
      last_name:  last_name?.trim() || null,
      email:      email.toLowerCase().trim(),
      password_hash: hash,
      role_id:    roleRow?.id || 4,
      is_active:  1,
    });
    res.status(201).json({ success: true, id });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/users/:id', authMw, requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    const { first_name, last_name, email, role, is_active, password } = req.body;
    const data = {};
    if (first_name !== undefined) data.first_name = first_name?.trim() || null;
    if (last_name  !== undefined) data.last_name  = last_name?.trim() || null;
    if (email      !== undefined) data.email      = email?.toLowerCase().trim() || null;
    if (is_active  !== undefined) data.is_active  = is_active ? 1 : 0;
    if (password) {
      if (password.length < 8)
        return res.status(400).json({ success: false, message: 'Mot de passe trop court.' });
      data.password_hash = await bcrypt.hash(password, 12);
    }
    if (role) {
      const r = await db.queryOne('SELECT id FROM roles WHERE name=?', [role]);
      if (r) data.role_id = r.id;
    }
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ à modifier.' });
    const aff = await db.update('users', data, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/users/:id', authMw, requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    if (id === req.user.id)
      return res.status(400).json({ success: false, message: 'Impossible de supprimer votre propre compte.' });
    const aff = await db.update('users', { is_active: 0 }, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  SETTINGS
// ============================================================
app.get('/api/settings', authOptional, async (_req, res) => {
  try {
    const rows = await db.query('SELECT setting_key, value FROM app_settings');
    const settings = {};
    rows.forEach(r => settings[r.setting_key] = r.value);
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/settings', authOptional, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      const exists = await db.queryOne('SELECT id FROM app_settings WHERE setting_key=?', [key]);
      if (exists) {
        await db.update('app_settings', { value: String(value) }, 'setting_key=?', [key]);
      } else {
        await db.insert('app_settings', { setting_key: key, value: String(value) });
      }
    }
    res.json({ success: true, message: 'Paramètres sauvegardés.' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  STATS
// ============================================================
app.get('/api/stats', authOptional, async (_req, res) => {
  try {
    const row = await db.queryOne('SELECT * FROM v_global_stats');
    res.json({ success: true, stats: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  FALLBACK SPA
// ============================================================
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: err.message || 'Erreur serveur.' });
});

// ── Démarrage
const server = app.listen(PORT, () => {
  console.log(`\n🚀  lexpert API démarrée — http://localhost:${PORT}`);
  console.log(`📦  Environnement : ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️   Base de données : ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);
});

// ── Graceful shutdown — let PM2/systemd send SIGTERM, finish in-flight requests, close pool
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(async () => {
    try { await db.close(); } catch (e) { console.error('DB close error:', e.message); }
    process.exit(0);
  });
  // Hard-kill if shutdown hangs (e.g. stuck connections)
  setTimeout(() => { console.error('Forced exit'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
