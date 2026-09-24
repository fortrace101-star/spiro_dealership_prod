const express = require('express');
const { one, many, query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const COLS = 'id, kind, title, body, url, tag, payload, read_at, created_at';

/**
 * Durable inbox shared by admin + POS (rows are scoped to req.user).
 * GET /             → latest 30 rows + unread count (bell badge)
 * GET /unread-count → just the badge number (cheap poll)
 * POST /read-all    → mark everything read
 * POST /:id/read    → mark one row read (idempotent)
 */

router.get('/', async (req, res) => {
  try {
    const [notifications, counts] = await Promise.all([
      many(`SELECT ${COLS} FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.user.id]),
      one(`SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]),
    ]);
    res.json({ notifications, unread_count: counts ? counts.unread : 0 });
  } catch (err) {
    console.error('[notifications]', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const r = await one(`SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
    res.json({ unread_count: r ? r.unread : 0 });
  } catch (err) {
    console.error('[notifications/unread]', err);
    res.json({ unread_count: 0 });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read-all]', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const rec = await one(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!rec) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications/read]', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;