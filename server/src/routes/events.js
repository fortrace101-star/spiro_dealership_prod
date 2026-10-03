const express = require('express');
const { getUserFromToken } = require('../auth');

const router = express.Router();

/**
 * Server-Sent Events hub (Workstream D).
 *
 * One long-lived `GET /api/events` stream per client replaces the badge/report
 * polling latency: the POS hears about a credit decision the instant an admin
 * acts, and the admin console recounts its badges the moment a sale lands.
 *
 * `emit(type, payload)` is exported so any route or service can publish after
 * its DB commit without knowing which clients are attached. Delivery is
 * best-effort — the existing 30s polling stays as the fallback.
 */

/** Connected streams: { res, userId, role }. */
const clients = new Set();

function write(res, type, payload) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

/** Broadcast a domain event to every connected client. Never throws. */
function emit(type, payload = {}) {
  if (clients.size === 0) return;
  for (const client of clients) {
    try {
      write(client.res, type, payload);
    } catch {
      clients.delete(client);
    }
  }
}

/** EventSource cannot send an Authorization header, so the stream authenticates
 *  from a `?token=` query param (validated exactly like the Bearer path). */
router.get('/', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Session expired — sign in again' });
  if (!user.is_active) return res.status(401).json({ error: 'Access deactivated — contact the administrator' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell any reverse proxy not to buffer the stream.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const client = { res, userId: user.id, role: user.role };
  clients.add(client);

  // Opening frame: the client can treat `ready` as \"stream live\" and kick a
  // first refresh, while `retry` asks the browser to reconnect after 3s.
  write(res, 'ready', { userId: user.id, at: new Date().toISOString() });
  res.write('retry: 3000\n\n');

  // 25s comment heartbeat keeps intermediaries (and the browser) from dropping
  // an idle connection. Never a data frame, so it cannot be mistaken for state.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { cleanup(); }
  }, 25000);

  function cleanup() {
    clearInterval(heartbeat);
    clients.delete(client);
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
});

module.exports = { router, emit };
