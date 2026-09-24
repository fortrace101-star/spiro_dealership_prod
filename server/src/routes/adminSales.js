const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** Sales list with cashier/customer names + optional filters */
router.get('/', async (req, res) => {
  const { q, days, payment, from, to, limit = 100 } = req.query;
  const params = [];
  let where = `WHERE 1=1`;

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (s.receipt_no ILIKE $${params.length} OR COALESCE(c.full_name,'') ILIKE $${params.length} OR COALESCE(u.full_name,'') ILIKE $${params.length})`;
  }

  // Date window: explicit from/to instants take precedence over a trailing day count
  const fromDate = from ? new Date(String(from)) : null;
  const toDate = to ? new Date(String(to)) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    params.push(fromDate.toISOString());
    where += ` AND s.created_at >= $${params.length}`;
    if (toDate && !Number.isNaN(toDate.getTime())) {
      params.push(toDate.toISOString());
      where += ` AND s.created_at <= $${params.length}`;
    }
  } else if (days) {
    params.push(String(days));
    where += ` AND s.created_at >= now() - ($${params.length} || ' days')::interval`;
  }

  if (payment) {
    params.push(payment);
    where += ` AND s.payment_method = $${params.length}`;
  }

  const sales = await many(
    `SELECT s.id, s.receipt_no, s.subtotal, s.discount, s.total, s.profit, s.payment_method,
            s.status, s.device_id, s.client_txn_id, s.created_at,
            u.full_name AS cashier_name, c.full_name AS customer_name,
            (SELECT a.status FROM approvals a
              WHERE a.type = 'credit_sale' AND a.payload->>'sale_id' = s.id::text
              ORDER BY a.created_at DESC LIMIT 1) AS approval_status
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
       LEFT JOIN customers c ON c.id = s.customer_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT ${Math.min(Number(limit) || 100, 500)}`,
    params
  );
  res.json({ sales });
});

/** Sale detail with line items */
router.get('/:id', async (req, res) => {
  const sale = await one(
    `SELECT s.*, u.full_name AS cashier_name, c.full_name AS customer_name, c.phone AS customer_phone,
            b.vin AS bike_vin, b.model AS bike_model
       FROM sales s
       LEFT JOIN users u ON u.id = s.cashier_id
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN bikes b ON b.id = s.bike_id
      WHERE s.id = $1`,
    [req.params.id]
  );
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const items = await many(`SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY created_at`, [req.params.id]).catch(() =>
    many(`SELECT * FROM sale_items WHERE sale_id = $1`, [req.params.id])
  );
  res.json({ sale, items });
});

module.exports = router;
