const express = require('express');
const { one, many } = require('../db');
const { signToken, hashPassword, verifyPassword } = require('../auth');
const { audit } = require('../middleware/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** POS operator self-registration using an admin-generated code */
router.post('/register', async (req, res) => {
  try {
    const { code, full_name, email, phone, password, device_id } = req.body || {};
    if (!code || !full_name || !password) {
      return res.status(400).json({ error: 'code, full_name and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const rec = await one(
      `SELECT * FROM activation_codes
        WHERE upper(code) = upper($1) AND used_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [code]
    );
    if (!rec) return res.status(400).json({ error: 'Invalid, expired, or already used code' });

    const existingEmail = email
      ? await one(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email])
      : null;
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await hashPassword(password);
    const user = await one(
      `INSERT INTO users (full_name, email, phone, password_hash, role, activated_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5, now(), now()) RETURNING *`,
      [full_name, email || null, phone || null, password_hash, rec.role]
    );

    await one(`UPDATE activation_codes SET used_at = now(), claimed_by = $1 WHERE id = $2`, [user.id, rec.id]);
    await audit({ userId: user.id, action: 'register', entity: 'user', entityId: user.id, meta: { code: rec.code, role: rec.role, device_id } });

    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await one(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await one(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    await audit({ userId: user.id, action: 'login', entity: 'user', entityId: user.id });

    res.json({
      token: signToken(user),
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** Change own password */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current, next } = req.body || {};
    const user = await one(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
    if (!(await verifyPassword(current || '', user.password_hash))) {
      return res.status(401).json({ error: 'Current password is wrong' });
    }
    if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password too short' });
    await one(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(next), user.id]);
    await audit({ userId: user.id, action: 'change_password', entity: 'user', entityId: user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/** Who has registered via codes — for the admin Team page */
router.get('/staff', requireAuth, async (req, res) => {
  try {
    const users = await many(
      `SELECT id, full_name, email, phone, role, is_active, last_login_at, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.json({ users });
  } catch (err) {
    console.error('[auth/staff]', err);
    res.status(500).json({ error: 'Failed to load staff' });
  }
});

module.exports = router;
