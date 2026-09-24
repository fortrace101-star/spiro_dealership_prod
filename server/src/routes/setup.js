const express = require('express');
const crypto = require('crypto');
const { pool, one } = require('../db');
const { signToken, hashPassword } = require('../auth');
const { audit } = require('../middleware/audit');
const { effectivePermissions } = require('../permissions/catalog');
const { setupRequired } = require('../bootstrap');

const router = express.Router();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeCode = (code) => String(code || '').trim().toUpperCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Public (no auth): the admin app asks this before rendering anything. */
router.get('/status', async (req, res) => {
  try {
    res.json({ setup_required: await setupRequired() });
  } catch (err) {
    console.error('[setup/status]', err);
    res.status(500).json({ error: 'Could not read setup status' });
  }
});

/**
 * Consume the one-time code and create the first administrator.
 * Same response shape as /api/auth/login so the client can store the session
 * the same way.
 */
router.post('/complete', async (req, res) => {
  try {
    const { code, full_name, email: rawEmail, password } = req.body || {};
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';

    if (!code || !full_name || !email || !password) {
      return res.status(400).json({ error: 'Setup code, full name, email and password are required' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!(await setupRequired())) {
      return res.status(409).json({ error: 'Setup has already been completed' });
    }

    const password_hash = await hashPassword(password);

    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      // Serialise bootstrap so two simultaneous requests (or two different
      // codes) can never both succeed and leave the install with 2 admins.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('spiro_admin_setup'))`);

      const stillRequired = await client.query(
        `SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND is_active) AS admin_exists`
      );
      if (stillRequired.rows[0].admin_exists) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Setup has already been completed' });
      }

      const dupe = await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
      if (dupe.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Email already registered' });
      }

      // One-shot claim: only an unused, unexpired code matches, and it is
      // marked used in the same statement, so it can never be replayed.
      const claim = await client.query(
        `UPDATE admin_recovery_codes SET used_at = now()
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING id`,
        [sha256(normalizeCode(code))]
      );
      if (!claim.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid, expired, or already used code' });
      }

      const user = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, permissions, activated_at, last_login_at)
         VALUES ($1,$2,$3,'admin','[]'::jsonb, now(), now()) RETURNING *`,
        [String(full_name).trim(), email, password_hash]
      );
      await client.query(`UPDATE admin_recovery_codes SET claimed_by = $1 WHERE id = $2`, [
        user.rows[0].id,
        claim.rows[0].id,
      ]);

      await client.query('COMMIT');
      created = { user: user.rows[0], codeId: claim.rows[0].id };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await audit({
      userId: created.user.id,
      action: 'setup_complete',
      entity: 'user',
      entityId: created.user.id,
      meta: { email, recovery_code_id: created.codeId },
    });

    res.status(201).json({
      token: signToken(created.user),
      user: {
        id: created.user.id,
        full_name: created.user.full_name,
        email: created.user.email,
        role: created.user.role,
        permissions: created.user.permissions || [],
        effective_permissions: effectivePermissions(created.user),
      },
      unread_count: 0,
      notifications: [],
    });
  } catch (err) {
    console.error('[setup/complete]', err);
    res.status(500).json({ error: 'Setup failed' });
  }
});

module.exports = router;
