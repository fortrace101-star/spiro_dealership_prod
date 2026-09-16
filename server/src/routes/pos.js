const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { recordSale } = require('../services/sales');

const router = express.Router();
router.use(requireAuth);

/** Full catalog snapshot for POS bootstrap (products + bikes in stock) */
router.get('/catalog', async (req, res) => {
  const products = await many(
    `SELECT id, sku, barcode, name, category, brand, selling_price, cost_price, stock_qty, min_stock, reorder_level, updated_at
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
    server_time: new Date().toISOString(),
  });
});

/** Record a sale (idempotent via client_txn_id) — used by POS online checkout & sync */
router.post('/sales', async (req, res) => {
  try {
    const input = req.body || {};
    if (!input.client_txn_id) return res.status(400).json({ error: 'client_txn_id required' });
    if (!Array.isArray(input.items) || input.items.length === 0) return res.status(400).json({ error: 'items required' });

    const result = await recordSale(input, req.user);
    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      sale: result.sale,
      items: result.items,
    });
  } catch (err) {
    console.error('[pos/sales]', err);
    res.status(500).json({ error: 'Failed to record sale', detail: err.message });
  }
});

/** Cashier's own recent sales */
router.get('/sales', async (req, res) => {
  const sales = await many(
    `SELECT id, receipt_no, subtotal, discount, total, payment_method, status, created_at
       FROM sales WHERE cashier_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]
  );
  res.json({ sales });
});

/** Today's numbers for the logged-in cashier */
router.get('/me/today', async (req, res) => {
  const stats = await one(
    `SELECT count(*)::int AS sales_count,
            COALESCE(sum(total),0) AS revenue,
            COALESCE(sum(profit),0) AS profit
       FROM sales
      WHERE cashier_id = $1 AND created_at >= date_trunc('day', now())`, [req.user.id]
  );
  res.json({ today: stats });
});

module.exports = router;
