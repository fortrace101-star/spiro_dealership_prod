const express = require('express');
const { many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { save } = require('../services/purchasing');
const router = express.Router();
router.use(requireAuth);
router.get('/catalog', async (req, res) => {
  const products = await many('SELECT id,sku,name,stock_qty,reorder_level,cost_price FROM products WHERE active=TRUE ORDER BY name');
  res.json({ products, can_receive: ['admin', 'manager'].includes(req.user.role) || (req.user.permissions || []).includes('inventory_entry') });
});
for (const [path, table] of [['consignments', 'consignments'], ['reorders', 'reorder_lists']]) {
  const guard = path === 'consignments' ? requirePermission('inventory_entry') : (req, res, next) => next();
  router.get(`/${path}`, guard, async (req, res) => {
    const records = await many(`SELECT r.*, u.full_name AS created_by_name FROM ${table} r JOIN users u ON u.id=r.created_by ORDER BY r.created_at DESC LIMIT 100`);
    res.json({ records });
  });
  router.post(`/${path}`, guard, async (req, res, next) => {
    try {
      const result = await save(table, req.body || {}, req.user);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });
}
module.exports = router;
