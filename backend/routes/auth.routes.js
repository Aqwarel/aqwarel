// ============================================================
//  routes/auth.routes.js — Authentification
// ============================================================
'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/db');
const router   = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, message: 'Email et mot de passe requis.' });

  try {
    const user = await db.queryOne(
      `SELECT u.*, r.name AS role_name FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? AND u.is_active = 1`,
      [email.toLowerCase().trim()]
    );

    if (!user)
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect.' });

    // Mettre à jour last_login_at
    await db.update('users', { last_login_at: new Date() }, 'id = ?', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role_name, firstName: user.first_name, lastName: user.last_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role_name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
});

// POST /api/auth/register — DÉSACTIVÉ
// L'auto-inscription est désactivée. Seul un admin peut créer un utilisateur
// via l'interface Utilisateurs (qui appelle POST /api/users avec auth admin).
router.post('/register', (_req, res) => {
  res.status(403).json({
    success: false,
    message: 'Inscription publique désactivée. Contactez un administrateur pour obtenir un compte.'
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  // JWT est stateless — le client supprime juste son token
  res.json({ success: true, message: 'Déconnexion réussie.' });
});

module.exports = router;
