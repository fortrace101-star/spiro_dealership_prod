const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recordSale } = require('../services/sales');

const router = express.Router();

/** Push: POS uploads offline sales batch. Each sale is idempotent (client_txn_id). */
router.post('/push', requireAuth, async (req, res) => {
  const results = { accepted: [], duplicates: [], failed: [] };
  const sales = Array.isArray(req.body?.sales) ? req.body.sales : [];

  for (const input of sales) {
    try {
      if (!input.client_txn_id || !Array.isArray(input.items) || input.items.length === 0) {
        results.failed.push({ client_txn_id: input.client_txn_id, error: 'invalid payload' });
        continue;
      }
      const r = await recordSale(input, req.user);
      if (r.duplicate) results.duplicates.push(input.client_txn_id);
      else results.accepted.push({ client_txn_id: input.client_txn_id, id: r.sale.id, receipt_no: r.sale.receipt_no });
    } catch (err) {
      console.error('[sync/push] sale failed:', err.message);
      results.failed.push({ client_txn_id: input.client_txn_id, error: err.message });
    }
  }

  res.json({
    ok: results.failed.length === 0,
    server_time: new Date().toISOString(),
    ...results,
  });
});

/** Pull: incremental changes since cursor (change-log style). */
router.get('/changes', requireAuth, async (req, res) => {
  const since = new Date(Number(req.query.since) || 0);
  const products = await many(
    `SELECT id, sku, barcode, name, category, brand, selling_price, cost_price, stock_qty, min_stock, reorder_level, active, updated_at
       FROM products WHERE updated_at > $1 ORDER BY updated_at LIMIT 1000`, [since.toISOString()]
  );
  const bikes = await many(
    `SELECT id, vin, model, color, year, selling_price, cost_price, battery_serial, battery_spec, status, updated_at
       FROM bikes WHERE updated_at > $1 ORDER BY updated_at LIMIT 1000`, [since.toISOString()]
  );
  const categories = await many(`SELECT DISTINCT category FROM products WHERE active = TRUE`);
  res.json({
    products,
    bikes,
    categories: categories.map((c) => c.category),
    cursor: Date.now(),
    server_time: new Date().toISOString(),
  });
});

/** Full bootstrap (first online run): complete catalog + cursor. */
router.get('/bootstrap', requireAuth, async (req, res) => {
  const products = await many(
    `SELECT id, sku, barcode, name, category, brand, selling_price, cost_price, stock_qty, min_stock, reorder_level, active, updated_at
       FROM products WHERE active = TRUE ORDER BY name`
  );
  const bikes = await many(
    `SELECT id, vin, model, color, year, selling_price, cost_price, battery_serial, battery_spec, status, updated_at
       FROM bikes WHERE status = 'in_stock' ORDER BY model`
  );
  const categories = await many(`SELECT DISTINCT category FROM products WHERE active = TRUE`);
  res.json({
    products,
    bikes,
    categories: categories.map((c) => c.category),
    cursor: Date.now(),
    server_time: new Date().toISOString(),
  });
});

module.exports = router;
