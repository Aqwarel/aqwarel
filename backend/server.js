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
const fs          = require('fs');
const crypto      = require('crypto');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');

// Dossier où sont stockés les PDF de contrats générés
const CONTRACTS_DIR = path.join(__dirname, '..', 'public', 'contracts');
if (!fs.existsSync(CONTRACTS_DIR)) fs.mkdirSync(CONTRACTS_DIR, { recursive: true });

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
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ── Anti-cache pour toutes les réponses /api/*
// Empêche le navigateur et nginx de servir des données API obsolètes
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

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
//  CLIENTS  (modele etendu : adresse, ville, CIN, note)
// ============================================================
app.get('/api/clients', authOptional, async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `SELECT c.*,
                 (SELECT COUNT(*) FROM credits cr WHERE cr.client_id = c.id AND cr.status <> 'annule')         AS credits_count,
                 (SELECT COUNT(*) FROM credits cr WHERE cr.client_id = c.id AND cr.status = 'retard')          AS credits_retard,
                 (SELECT COALESCE(SUM(cr.total_price - cr.down_payment),0) FROM credits cr
                    WHERE cr.client_id = c.id AND cr.status IN ('en_cours','retard'))                          AS total_to_pay,
                 (SELECT COALESCE(SUM(e.paid_amount),0) FROM echeances e
                    JOIN credits cr ON cr.id = e.credit_id
                    WHERE cr.client_id = c.id AND cr.status IN ('en_cours','retard'))                          AS total_paid_open
               FROM clients c
               WHERE c.is_active = 1`;
    const params = [];
    if (search) {
      sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ? OR c.cin LIKE ? OR c.email LIKE ? OR CAST(c.display_id AS CHAR) = ?)`;
      const like = '%' + String(search).trim() + '%';
      params.push(like, like, like, like, like, String(search).trim());
    }
    sql += ' ORDER BY c.display_id';
    const rows = await db.query(sql, params);
    res.json({ success: true, clients: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/clients/:id', authOptional, async (req, res) => {
  try {
    const id  = +req.params.id;
    const row = await db.queryOne('SELECT * FROM clients WHERE id = ? AND is_active = 1', [id]);
    if (!row) return res.status(404).json({ success: false, message: 'Client introuvable.' });
    res.json({ success: true, client: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/clients', authOptional, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, cin, address, city, notes } = req.body;
    if (!first_name?.trim())
      return res.status(400).json({ success: false, message: 'Nom obligatoire.' });

    const row = await db.queryOne('SELECT COALESCE(MAX(display_id),0)+1 AS next_id FROM clients');
    const id  = await db.insert('clients', {
      display_id: row.next_id,
      first_name: first_name.trim(),
      last_name:  last_name?.trim() || null,
      email:      email?.trim() || null,
      phone:      phone?.trim() || null,
      cin:        cin?.trim() || null,
      address:    address?.trim() || null,
      city:       city?.trim() || null,
      notes:      notes?.trim() || null,
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
    const { first_name, last_name, email, phone, cin, address, city, notes } = req.body;
    const data = {};
    if (first_name !== undefined) data.first_name = first_name?.trim() || null;
    if (last_name  !== undefined) data.last_name  = last_name?.trim() || null;
    if (email      !== undefined) data.email      = email?.trim() || null;
    if (phone      !== undefined) data.phone      = phone?.trim() || null;
    if (cin        !== undefined) data.cin        = cin?.trim() || null;
    if (address    !== undefined) data.address    = address?.trim() || null;
    if (city       !== undefined) data.city       = city?.trim() || null;
    if (notes      !== undefined) data.notes      = notes?.trim() || null;
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
    // Soft-delete : on desactive le client. Les credits restent (historique).
    const aff = await db.update('clients', { is_active: 0 }, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Client introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  CREDITS  (nouveau modele : pret a echeances)
// ============================================================

// Calcule le statut a jour d'un credit en regardant ses echeances
async function refreshCreditStatus(conn, creditId) {
  const [[c]] = await conn.execute('SELECT * FROM credits WHERE id = ?', [creditId]);
  if (!c) return;
  if (c.status === 'annule') return;

  const [rows] = await conn.execute(
    `SELECT status, due_date, amount, paid_amount FROM echeances WHERE credit_id = ?`,
    [creditId]
  );

  const today = new Date().toISOString().slice(0,10);
  let allPaid = rows.length > 0;
  let anyLate = false;

  for (const e of rows) {
    if (e.status !== 'payee') allPaid = false;
    if (e.status !== 'payee' && String(e.due_date).slice(0,10) < today) anyLate = true;
  }

  let newStatus = c.status;
  if (allPaid)      newStatus = 'paye';
  else if (anyLate) newStatus = 'retard';
  else              newStatus = 'en_cours';

  if (newStatus !== c.status) {
    await conn.execute('UPDATE credits SET status = ? WHERE id = ?', [newStatus, creditId]);
  }
  // Recalcule "remaining"
  const totalPaid = rows.reduce((s,r) => s + parseFloat(r.paid_amount || 0), 0);
  const remaining = parseFloat(c.total_price) - parseFloat(c.down_payment) - totalPaid;
  await conn.execute('UPDATE credits SET remaining = ? WHERE id = ?', [Math.max(0, remaining), creditId]);
}

// GET /api/credits — liste avec filtres
app.get('/api/credits', authOptional, async (req, res) => {
  try {
    const { client_id, status, search, from, to } = req.query;
    let sql = `SELECT cr.*,
                 CONCAT(c.first_name,' ',COALESCE(c.last_name,'')) AS client_name,
                 c.display_id AS client_display_id,
                 c.phone      AS client_phone,
                 c.cin        AS client_cin,
                 CONCAT(u.first_name,' ',COALESCE(u.last_name,'')) AS operator_name,
                 (SELECT COALESCE(SUM(paid_amount),0) FROM echeances WHERE credit_id = cr.id) AS total_paid_echeances,
                 (SELECT MIN(due_date) FROM echeances
                    WHERE credit_id = cr.id AND status IN ('a_payer','retard','partielle')) AS next_due_date
               FROM credits cr
               LEFT JOIN clients c ON c.id = cr.client_id
               LEFT JOIN users u   ON u.id = cr.user_id
               WHERE 1=1`;
    const params = [];
    if (client_id) { sql += ' AND cr.client_id = ?'; params.push(+client_id); }
    if (status)    { sql += ' AND cr.status = ?';    params.push(status); }
    if (from)      { sql += ' AND cr.start_date >= ?'; params.push(from); }
    if (to)        { sql += ' AND cr.start_date <= ?'; params.push(to); }
    if (search) {
      sql += ` AND (cr.product_name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ? OR CAST(cr.id AS CHAR) = ?)`;
      const like = '%' + String(search).trim() + '%';
      params.push(like, like, like, like, String(search).trim());
    }
    sql += ' ORDER BY cr.created_at DESC LIMIT 1000';
    const rows = await db.query(sql, params);
    res.json({ success: true, credits: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/credits/:id — detail avec echeances
app.get('/api/credits/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const credit = await db.queryOne(
      `SELECT cr.*,
              CONCAT(c.first_name,' ',COALESCE(c.last_name,'')) AS client_name,
              c.display_id AS client_display_id,
              c.phone, c.cin, c.address, c.city
       FROM credits cr LEFT JOIN clients c ON c.id = cr.client_id WHERE cr.id = ?`,
      [id]
    );
    if (!credit) return res.status(404).json({ success: false, message: 'Crédit introuvable.' });
    const echeances = await db.query(
      `SELECT e.*, pm.label AS payment_method_label
       FROM echeances e LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
       WHERE e.credit_id = ? ORDER BY e.installment_no`,
      [id]
    );
    res.json({ success: true, credit, echeances });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/credits — cree un credit ET genere les echeances automatiquement
app.post('/api/credits', authOptional, async (req, res) => {
  try {
    const {
      client_id, product_name, total_price, down_payment,
      num_installments, start_date, note,
    } = req.body;

    if (!client_id || !product_name?.trim())
      return res.status(400).json({ success: false, message: 'Client et produit obligatoires.' });

    const total = parseFloat(total_price) || 0;
    const down  = parseFloat(down_payment) || 0;
    const n     = parseInt(num_installments, 10) || 1;
    if (total <= 0)         return res.status(400).json({ success: false, message: 'Prix total invalide.' });
    if (down < 0 || down > total)
      return res.status(400).json({ success: false, message: 'Avance invalide.' });
    if (n < 1)              return res.status(400).json({ success: false, message: 'Nombre d\'échéances invalide.' });

    const remaining = total - down;
    // Arrondi a 2 decimales pour les n-1 premieres, derniere = solde exact
    const baseAmt = Math.floor((remaining / n) * 100) / 100;
    const lastAmt = Math.round((remaining - baseAmt * (n - 1)) * 100) / 100;

    const startDate = start_date || new Date().toISOString().slice(0,10);

    const result = await db.transaction(async (conn) => {
      const [ins] = await conn.execute(
        `INSERT INTO credits
           (client_id, user_id, product_name, total_price, down_payment, remaining,
            num_installments, installment_amount, start_date, status, note)
         VALUES (?,?,?,?,?,?,?,?,?, 'en_cours', ?)`,
        [
          +client_id, req.user?.id || null,
          String(product_name).trim(),
          total, down, remaining,
          n, baseAmt, startDate, note?.trim() || null,
        ]
      );
      const creditId = ins.insertId;

      // Genere les echeances : une par mois a partir de start_date
      const baseDate = new Date(startDate + 'T00:00:00Z');
      for (let i = 0; i < n; i++) {
        const due = new Date(baseDate);
        due.setUTCMonth(due.getUTCMonth() + i + 1);
        const dueStr = due.toISOString().slice(0,10);
        const amt = (i === n - 1) ? lastAmt : baseAmt;
        await conn.execute(
          `INSERT INTO echeances (credit_id, installment_no, due_date, amount, status)
           VALUES (?,?,?,?, 'a_payer')`,
          [creditId, i + 1, dueStr, amt]
        );
      }

      await refreshCreditStatus(conn, creditId);
      return creditId;
    });

    res.status(201).json({ success: true, id: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/credits/:id/contract-pdf
// Le frontend génère le PDF (via jsPDF) puis l'envoie ici en base64.
// On le stocke dans public/contracts/CR-XXXXX-<token>.pdf et on retourne l'URL.
// Le token aléatoire (16 hex chars = 64 bits) sert de "security by obscurity"
// pour empêcher de deviner le PDF d'un autre crédit.
app.post('/api/credits/:id/contract-pdf', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { pdf } = req.body;
    if (!pdf || typeof pdf !== 'string' || !pdf.startsWith('data:application/pdf;base64,')) {
      return res.status(400).json({ success: false, message: 'PDF invalide.' });
    }
    const b64 = pdf.slice('data:application/pdf;base64,'.length);
    const buf = Buffer.from(b64, 'base64');
    // Garde-fou : max 10 Mo
    if (buf.length > 10 * 1024 * 1024) {
      return res.status(413).json({ success: false, message: 'PDF trop volumineux (max 10 Mo).' });
    }
    // Vérifie que le crédit existe
    const row = await db.queryOne('SELECT id FROM credits WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ success: false, message: 'Crédit introuvable.' });

    const token = crypto.randomBytes(8).toString('hex');
    const fileName = `CR-${String(id).padStart(5, '0')}-${token}.pdf`;
    fs.writeFileSync(path.join(CONTRACTS_DIR, fileName), buf);
    res.json({ success: true, url: `/contracts/${fileName}`, fileName });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/credits/:id — modifier infos basiques (sans regenerer les echeances)
app.put('/api/credits/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { product_name, note, status } = req.body;
    const data = {};
    if (product_name !== undefined) data.product_name = String(product_name).trim();
    if (note         !== undefined) data.note         = note?.trim() || null;
    if (status       !== undefined) {
      if (!['en_cours','paye','retard','annule'].includes(status))
        return res.status(400).json({ success: false, message: 'Statut invalide.' });
      data.status = status;
    }
    if (!Object.keys(data).length)
      return res.status(400).json({ success: false, message: 'Aucun champ à modifier.' });

    const aff = await db.update('credits', data, 'id=?', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Crédit introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE /api/credits/:id — suppression définitive
// Les échéances liées sont supprimées en cascade (FK ON DELETE CASCADE).
// Les paiements gardent une trace mais leur echeance_id devient NULL.
app.delete('/api/credits/:id', authOptional, async (req, res) => {
  try {
    const id  = +req.params.id;
    const [r] = await db.pool.execute('DELETE FROM credits WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Crédit introuvable.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
//  ECHEANCES  (installments)
// ============================================================

// GET /api/echeances — liste avec filtres : retard, jour, semaine
app.get('/api/echeances', authOptional, async (req, res) => {
  try {
    const { credit_id, status, due_from, due_to, scope } = req.query;
    let sql = `SELECT e.*,
                 cr.product_name, cr.client_id,
                 CONCAT(c.first_name,' ',COALESCE(c.last_name,'')) AS client_name,
                 c.display_id AS client_display_id,
                 c.phone      AS client_phone,
                 pm.label     AS payment_method_label
               FROM echeances e
               LEFT JOIN credits  cr ON cr.id = e.credit_id
               LEFT JOIN clients  c  ON c.id  = cr.client_id
               LEFT JOIN payment_methods pm ON pm.id = e.payment_method_id
               WHERE 1=1`;
    const params = [];
    if (credit_id) { sql += ' AND e.credit_id = ?'; params.push(+credit_id); }
    if (status)    { sql += ' AND e.status = ?';    params.push(status); }
    if (due_from)  { sql += ' AND e.due_date >= ?'; params.push(due_from); }
    if (due_to)    { sql += ' AND e.due_date <= ?'; params.push(due_to); }

    if (scope === 'today') {
      sql += ' AND e.due_date = CURDATE() AND e.status <> \'payee\'';
    } else if (scope === 'week') {
      sql += ' AND e.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND e.status <> \'payee\'';
    } else if (scope === 'overdue') {
      sql += ' AND e.due_date < CURDATE() AND e.status <> \'payee\'';
    }

    sql += ' ORDER BY e.due_date ASC, e.installment_no ASC LIMIT 2000';
    const rows = await db.query(sql, params);
    res.json({ success: true, echeances: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /api/echeances/:id/pay — encaisse un paiement (total ou partiel)
app.put('/api/echeances/:id/pay', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { amount, payment_method, payment_date, note } = req.body;
    const pmId  = await resolvePaymentMethodId(payment_method);
    const today = payment_date || new Date().toISOString().slice(0,10);

    const result = await db.transaction(async (conn) => {
      const [[e]] = await conn.execute('SELECT * FROM echeances WHERE id = ? FOR UPDATE', [id]);
      if (!e) throw new Error('NOT_FOUND');
      if (e.status === 'payee') throw new Error('ALREADY_PAID');

      const due       = parseFloat(e.amount);
      const already   = parseFloat(e.paid_amount || 0);
      const toPay     = amount === undefined ? (due - already) : parseFloat(amount);
      if (toPay <= 0) throw new Error('INVALID_AMOUNT');

      const newPaid   = already + toPay;
      const newStatus = newPaid + 0.005 >= due ? 'payee' : 'partielle';

      await conn.execute(
        `UPDATE echeances
         SET paid_amount = ?, status = ?, paid_at = ?, payment_method_id = ?, note = COALESCE(?, note)
         WHERE id = ?`,
        [newPaid, newStatus, newStatus === 'payee' ? new Date() : null, pmId, note || null, id]
      );

      // Trace dans payments
      await conn.execute(
        `INSERT INTO payments (echeance_id, client_id, user_id, payment_method_id, amount, payment_date, note, status)
         SELECT ?, cr.client_id, ?, ?, ?, ?, ?, 'validated'
         FROM credits cr WHERE cr.id = ?`,
        [id, req.user?.id || null, pmId, toPay, today, note || null, e.credit_id]
      );

      await refreshCreditStatus(conn, e.credit_id);
      return { paid_amount: newPaid, status: newStatus };
    });

    res.json({ success: true, ...result });
  } catch (e) {
    if (e.message === 'NOT_FOUND')      return res.status(404).json({ success: false, message: 'Échéance introuvable.' });
    if (e.message === 'ALREADY_PAID')   return res.status(400).json({ success: false, message: 'Échéance déjà payée.' });
    if (e.message === 'INVALID_AMOUNT') return res.status(400).json({ success: false, message: 'Montant invalide.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/echeances/:id — modifier les champs de base (date, montant, paid_amount, note)
// Recalcule automatiquement le statut de l'échéance et le remaining du crédit parent.
app.put('/api/echeances/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    const { due_date, amount, paid_amount, note, payment_method, payment_date } = req.body;

    await db.transaction(async (conn) => {
      const [[e]] = await conn.execute('SELECT * FROM echeances WHERE id = ? FOR UPDATE', [id]);
      if (!e) throw new Error('NOT_FOUND');

      const newAmount     = amount      !== undefined ? parseFloat(amount)      : parseFloat(e.amount);
      const newPaid       = paid_amount !== undefined ? parseFloat(paid_amount) : parseFloat(e.paid_amount || 0);
      if (newAmount <= 0)   throw new Error('INVALID_AMOUNT');
      if (newPaid < 0)      throw new Error('INVALID_PAID');

      // Recalcul du statut depuis les nouvelles valeurs
      let newStatus;
      if (newPaid + 0.005 >= newAmount && newPaid > 0)      newStatus = 'payee';
      else if (newPaid > 0)                                   newStatus = 'partielle';
      else if (due_date && due_date < new Date().toISOString().slice(0,10))
                                                              newStatus = 'retard';
      else                                                    newStatus = 'a_payer';

      const pmId = payment_method !== undefined ? await resolvePaymentMethodId(payment_method) : e.payment_method_id;

      await conn.execute(
        `UPDATE echeances
         SET due_date = COALESCE(?, due_date),
             amount = ?,
             paid_amount = ?,
             status = ?,
             paid_at = ?,
             payment_method_id = ?,
             note = COALESCE(?, note)
         WHERE id = ?`,
        [
          due_date || null,
          newAmount,
          newPaid,
          newStatus,
          newStatus === 'payee' ? (payment_date ? new Date(payment_date) : (e.paid_at || new Date())) : null,
          pmId,
          note !== undefined ? (note || null) : null,
          id,
        ]
      );

      await refreshCreditStatus(conn, e.credit_id);
    });

    res.json({ success: true });
  } catch (e) {
    if (e.message === 'NOT_FOUND')        return res.status(404).json({ success: false, message: 'Échéance introuvable.' });
    if (e.message === 'INVALID_AMOUNT')   return res.status(400).json({ success: false, message: 'Montant invalide.' });
    if (e.message === 'INVALID_PAID')     return res.status(400).json({ success: false, message: 'Montant payé invalide.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/echeances/:id — supprime une échéance et recalcule le crédit parent
app.delete('/api/echeances/:id', authOptional, async (req, res) => {
  try {
    const id = +req.params.id;
    await db.transaction(async (conn) => {
      const [[e]] = await conn.execute('SELECT credit_id FROM echeances WHERE id = ?', [id]);
      if (!e) throw new Error('NOT_FOUND');
      await conn.execute('DELETE FROM echeances WHERE id = ?', [id]);
      await refreshCreditStatus(conn, e.credit_id);
    });
    res.json({ success: true });
  } catch (e) {
    if (e.message === 'NOT_FOUND') return res.status(404).json({ success: false, message: 'Échéance introuvable.' });
    res.status(500).json({ success: false, message: e.message });
  }
});

// PUT /api/echeances/:id/mark-late — force le statut "retard" (utile manuel)
app.put('/api/echeances/:id/mark-late', authOptional, async (req, res) => {
  try {
    const id  = +req.params.id;
    const aff = await db.update('echeances', { status: 'retard' }, 'id=? AND status <> \'payee\'', [id]);
    if (!aff) return res.status(404).json({ success: false, message: 'Échéance introuvable ou déjà payée.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/echeances/refresh-overdue — recalcule les retards (a appeler periodiquement)
app.post('/api/echeances/refresh-overdue', authOptional, async (_req, res) => {
  try {
    await db.query(
      `UPDATE echeances SET status = 'retard'
       WHERE status IN ('a_payer','partielle') AND due_date < CURDATE()`
    );
    // Met a jour les statuts des credits
    const creditIds = await db.query(`SELECT DISTINCT id FROM credits WHERE status <> 'annule'`);
    await db.transaction(async (conn) => {
      for (const c of creditIds) await refreshCreditStatus(conn, c.id);
    });
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

// DELETE /api/users/:id — suppression définitive
// Les references vers cet utilisateur (clients.created_by, credits.user_id,
// payments.user_id, etc.) passent à NULL grâce aux contraintes FK SET NULL.
app.delete('/api/users/:id', authMw, requireAdmin, async (req, res) => {
  try {
    const id = +req.params.id;
    if (id === req.user.id)
      return res.status(400).json({ success: false, message: 'Impossible de supprimer votre propre compte.' });
    const [r] = await db.pool.execute('DELETE FROM users WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
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
