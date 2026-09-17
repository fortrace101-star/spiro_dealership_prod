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
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/sales', require('./routes/adminSales'));
app.use('/api/pos', require('./routes/pos'));
app.use('/api/purchasing', require('./routes/purchasing'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/push', require('./routes/push'));
app.use('/api/reports', require('./routes/reports'));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Safety net: an unhandled rejection from a route must not kill the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = { app, initSchema };
