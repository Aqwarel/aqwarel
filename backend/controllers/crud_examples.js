// ============================================================
//  crud_examples.js — Exemples CRUD complets
//  Sécurité : requêtes paramétrées (anti injection SQL)
//  Stack    : Node.js + Express + mysql2
// ============================================================

'use strict';

const db = require('./db');

// ════════════════════════════════════════════════════════════
//  CLIENTS — CRUD
// ════════════════════════════════════════════════════════════

const ClientsController = {

  // ── CREATE : Ajouter un client
  async create(req, res) {
    const { first_name, last_name, email, phone, address, city } = req.body;

    // Validation
    if (!first_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Le prénom est obligatoire.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Email invalide.' });
    }

    try {
      // Calcul du prochain display_id
      const row = await db.queryOne(
        'SELECT COALESCE(MAX(display_id), 0) + 1 AS next_id FROM clients'
      );

      const insertId = await db.insert('clients', {
        display_id: row.next_id,
        first_name: first_name.trim(),
        last_name:  last_name?.trim() || null,
        email:      email?.trim().toLowerCase() || null,
        phone:      phone?.trim() || null,
        address:    address?.trim() || null,
        city:       city?.trim() || null,
        created_by: req.user?.id || null,
      });

      // Log d'activité
      await db.insert('activity_logs', {
        user_id:     req.user?.id,
        action:      'client.created',
        module:      'clients',
        record_id:   insertId,
        record_type: 'clients',
        new_values:  JSON.stringify({ first_name, email }),
        ip_address:  req.ip,
      });

      return res.status(201).json({
        success: true,
        message: 'Client créé avec succès.',
        data: { id: insertId, display_id: row.next_id },
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé.' });
      }
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── READ : Liste des clients avec leurs soldes
  async list(req, res) {
    const { search = '', active = '1', page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, +page) - 1) * Math.min(100, +limit);

    try {
      const searchLike = `%${search.trim()}%`;

      const clients = await db.query(
        `SELECT v.*, v.current_balance
         FROM v_client_balances v
         WHERE v.is_active = ?
           AND (v.full_name LIKE ? OR v.email LIKE ? OR v.phone LIKE ?)
         ORDER BY v.display_id ASC
         LIMIT ? OFFSET ?`,
        [+active, searchLike, searchLike, searchLike, +limit, offset]
      );

      const [{ total }] = await db.query(
        `SELECT COUNT(*) AS total FROM v_client_balances WHERE is_active = ?
         AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)`,
        [+active, searchLike, searchLike, searchLike]
      );

      return res.json({ success: true, data: clients, meta: { total, page: +page, limit: +limit } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── READ ONE : Fiche client complète
  async getOne(req, res) {
    const { id } = req.params;
    try {
      const client = await db.queryOne(
        'SELECT * FROM v_client_balances WHERE id = ?',
        [+id]
      );
      if (!client) return res.status(404).json({ success: false, message: 'Client introuvable.' });

      const credits = await db.query(
        `SELECT cr.*, pm.label AS method_label
         FROM credits cr
         LEFT JOIN payment_methods pm ON pm.id = cr.payment_method_id
         WHERE cr.client_id = ? AND cr.is_cancelled = 0
         ORDER BY cr.operation_date DESC, cr.id DESC
         LIMIT 50`,
        [+id]
      );

      return res.json({ success: true, data: { ...client, credits } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── UPDATE : Modifier un client
  async update(req, res) {
    const { id } = req.params;
    const { first_name, last_name, email, phone, address, city } = req.body;

    if (!first_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Le prénom est obligatoire.' });
    }

    try {
      const existing = await db.queryOne('SELECT * FROM clients WHERE id = ?', [+id]);
      if (!existing) return res.status(404).json({ success: false, message: 'Client introuvable.' });

      await db.update(
        'clients',
        {
          first_name: first_name.trim(),
          last_name:  last_name?.trim() || null,
          email:      email?.trim().toLowerCase() || null,
          phone:      phone?.trim() || null,
          address:    address?.trim() || null,
          city:       city?.trim() || null,
        },
        'id = ?',
        [+id]
      );

      // Log d'activité
      await db.insert('activity_logs', {
        user_id:     req.user?.id,
        action:      'client.updated',
        module:      'clients',
        record_id:   +id,
        record_type: 'clients',
        old_values:  JSON.stringify({ first_name: existing.first_name, email: existing.email }),
        new_values:  JSON.stringify({ first_name, email }),
        ip_address:  req.ip,
      });

      return res.json({ success: true, message: 'Client modifié avec succès.' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé.' });
      }
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── DELETE (soft) : Désactiver un client
  async deactivate(req, res) {
    const { id } = req.params;
    try {
      const affected = await db.update('clients', { is_active: 0 }, 'id = ?', [+id]);
      if (!affected) return res.status(404).json({ success: false, message: 'Client introuvable.' });

      await db.insert('activity_logs', {
        user_id: req.user?.id, action: 'client.deactivated',
        module: 'clients', record_id: +id, record_type: 'clients', ip_address: req.ip,
      });

      return res.json({ success: true, message: 'Client désactivé.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },
};


// ════════════════════════════════════════════════════════════
//  CRÉDITS — CRUD
// ════════════════════════════════════════════════════════════

const CreditsController = {

  // ── CREATE : Ajouter un crédit (transaction sécurisée)
  async add(req, res) {
    const { client_id, payment_method_id, amount, operation_date, note, reference } = req.body;

    if (!client_id || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Paramètres invalides.' });
    }

    try {
      const result = await db.transaction(async (conn) => {
        // Vérifier que le client existe
        const [clientRows] = await conn.execute(
          'SELECT id FROM clients WHERE id = ? AND is_active = 1',
          [+client_id]
        );
        if (!clientRows.length) throw new Error('CLIENT_NOT_FOUND');

        // Solde actuel (verrouillage FOR UPDATE pour éviter les race conditions)
        const [[balRow]] = await conn.execute(
          `SELECT COALESCE(SUM(CASE
             WHEN type='ajout'         THEN  amount
             WHEN type='utilisation'   THEN -amount
             WHEN type='remboursement' THEN -amount
           END), 0) AS balance
           FROM credits WHERE client_id = ? AND is_cancelled = 0
           FOR UPDATE`,
          [+client_id]
        );
        const balanceBefore = parseFloat(balRow.balance);

        // Insérer le crédit
        const [ins] = await conn.execute(
          `INSERT INTO credits
           (client_id, user_id, type, payment_method_id, amount, balance_before, balance_after, operation_date, note, reference)
           VALUES (?, ?, 'ajout', ?, ?, ?, ?, ?, ?, ?)`,
          [
            +client_id, req.user?.id || null, payment_method_id || null,
            parseFloat(amount), balanceBefore, balanceBefore + parseFloat(amount),
            operation_date || new Date().toISOString().slice(0, 10),
            note?.trim() || null, reference?.trim() || null,
          ]
        );
        return { insertId: ins.insertId, balanceBefore, balanceAfter: balanceBefore + parseFloat(amount) };
      });

      return res.status(201).json({ success: true, message: 'Crédit ajouté.', data: result });
    } catch (err) {
      if (err.message === 'CLIENT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Client introuvable ou inactif.' });
      }
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── READ : Historique avec filtres
  async history(req, res) {
    const { client_id, type, date_from, date_to, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, +page) - 1) * Math.min(100, +limit);

    const conditions = ['cr.is_cancelled = 0'];
    const params     = [];

    if (client_id)  { conditions.push('cr.client_id = ?');      params.push(+client_id); }
    if (type)       { conditions.push('cr.type = ?');            params.push(type); }
    if (date_from)  { conditions.push('cr.operation_date >= ?'); params.push(date_from); }
    if (date_to)    { conditions.push('cr.operation_date <= ?'); params.push(date_to); }

    const where = conditions.join(' AND ');

    try {
      const rows = await db.query(
        `SELECT cr.*, pm.label AS method_label,
                CONCAT(c.first_name, ' ', COALESCE(c.last_name,'')) AS client_name,
                c.display_id AS client_display_id
         FROM credits cr
         LEFT JOIN clients c         ON c.id  = cr.client_id
         LEFT JOIN payment_methods pm ON pm.id = cr.payment_method_id
         WHERE ${where}
         ORDER BY cr.operation_date DESC, cr.id DESC
         LIMIT ? OFFSET ?`,
        [...params, +limit, offset]
      );

      return res.json({ success: true, data: rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── UPDATE : Modifier une opération
  async update(req, res) {
    const { id }  = req.params;
    const { amount, note, payment_method_id, operation_date } = req.body;

    if (amount && amount <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide.' });
    }

    try {
      const existing = await db.queryOne(
        'SELECT * FROM credits WHERE id = ? AND is_cancelled = 0',
        [+id]
      );
      if (!existing) return res.status(404).json({ success: false, message: 'Opération introuvable.' });

      await db.update('credits', {
        ...(amount            ? { amount: parseFloat(amount) }              : {}),
        ...(note !== undefined ? { note: note?.trim() || null }             : {}),
        ...(payment_method_id  ? { payment_method_id: +payment_method_id }  : {}),
        ...(operation_date     ? { operation_date }                         : {}),
      }, 'id = ?', [+id]);

      await db.insert('activity_logs', {
        user_id: req.user?.id, action: 'credit.updated',
        module: 'credits', record_id: +id, record_type: 'credits',
        old_values: JSON.stringify({ amount: existing.amount }),
        new_values: JSON.stringify({ amount }), ip_address: req.ip,
      });

      return res.json({ success: true, message: 'Opération modifiée.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  // ── DELETE (soft cancel) : Annuler une opération
  async cancel(req, res) {
    const { id } = req.params;
    try {
      const affected = await db.update(
        'credits',
        { is_cancelled: 1, cancelled_at: new Date(), cancelled_by: req.user?.id || null },
        'id = ? AND is_cancelled = 0',
        [+id]
      );
      if (!affected) return res.status(404).json({ success: false, message: 'Opération introuvable.' });

      return res.json({ success: true, message: 'Opération annulée.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },
};


// ════════════════════════════════════════════════════════════
//  PARAMÈTRES — lecture / mise à jour
// ════════════════════════════════════════════════════════════

const SettingsController = {

  async getAll(req, res) {
    try {
      const rows = await db.query(
        'SELECT `key`, `value`, `type`, `group`, `label` FROM app_settings ORDER BY `group`, `key`'
      );
      // Reconstituer en objet { key: value }
      const settings = {};
      rows.forEach(r => { settings[r.key] = r.value; });
      return res.json({ success: true, data: settings });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },

  async update(req, res) {
    const updates = req.body; // { company_name: 'lexpert', … }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Données invalides.' });
    }

    try {
      for (const [key, value] of Object.entries(updates)) {
        // Vérifier que la clé existe (whitelist)
        const setting = await db.queryOne('SELECT id FROM app_settings WHERE `key` = ?', [key]);
        if (!setting) continue; // Ignorer les clés inconnues

        await db.update(
          'app_settings',
          { value: String(value), updated_by: req.user?.id || null },
          '`key` = ?',
          [key]
        );
      }
      return res.json({ success: true, message: 'Paramètres enregistrés.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Erreur serveur.' });
    }
  },
};

module.exports = { ClientsController, CreditsController, SettingsController };
