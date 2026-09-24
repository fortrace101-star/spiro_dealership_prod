const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { initSchema } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// ---- Health (used by POS connectivity polling) ----
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'spiro-api', time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/sales', require('./routes/adminSales'));
app.use('/api/pos', require('./routes/pos'));
app.use('/api/purchasing', require('./routes/purchasing'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/push', require('./routes/push'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/reports', require('./routes/reports'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Safety net: an unhandled rejection from a route must not kill the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});

// Error handler
// Connection-level failures (PostgreSQL down / refused / reset) are environmental
// and retryable, so they are reported as 503 with an actionable message rather
// than an opaque 500. The real error is always logged.
const DB_DOWN_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EHOSTUNREACH',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
]);

app.use((err, req, res, next) => {
  const detail = err?.message || String(err) || '(no error message)';
  console.error(`[error] ${req.method} ${req.originalUrl} → ${detail}${err?.code ? ` (code ${err.code})` : ''}`);
  if (err?.stack) console.error(err.stack);

  if (DB_DOWN_CODES.has(err?.code)) {
    return res.status(503).json({ error: 'Database unavailable — check that PostgreSQL is running and DATABASE_URL is correct' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = { app, initSchema };
