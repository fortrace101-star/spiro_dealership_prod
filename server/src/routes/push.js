const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/** VAPID public key so the dashboard can subscribe */
router.get('/vapid-public-key', (req, res) => {
  const { vapid } = require('../config');
  if (!vapid.publicKey) return res.status(503).json({ error: 'VAPID not configured' });
  res.json({ publicKey: vapid.publicKey });
});

/** Save a push subscription (admin dashboard devices) */
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys, user_agent } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });

  const existing = await one(`SELECT id FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  if (existing) {
    await many(`UPDATE push_subscriptions SET p256dh=$2, auth=$3, user_id=$4 WHERE id=$1`,
      [existing.id, keys.p256dh, keys.auth, req.user.id]);
    return res.json({ ok: true, updated: true });
  }

  const sub = await one(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, endpoint, keys.p256dh, keys.auth, user_agent || req.headers['user-agent'] || null]
  );
  res.status(201).json({ ok: true, subscription: sub });
});

/** Remove own subscription (unsubscribe) */
router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  await many(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [endpoint, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
