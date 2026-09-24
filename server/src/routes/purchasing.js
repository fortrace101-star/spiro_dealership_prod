const express = require('express');
const { many, one } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { hasPermission } = require('../permissions/catalog');
const { save, nextReorderRef } = require('../services/purchasing');
const { notifyUser, reorderStatus } = require('../services/push');

const router = express.Router();
router.use(requireAuth);

router.get('/catalog', async (req, res) => {
  const products = await many('SELECT id,sku,name,stock_qty,reorder_level,cost_price,selling_price FROM products WHERE active=TRUE ORDER BY name');
  // Capability flags mirror the permission catalog (the POS keeps its own
  // refreshed copy of the same set — see /api/auth/me).
  res.json({
    products,
    can_receive: hasPermission(req.user, 'inventory_receive'),
    // Legacy flag read by older cached POS bundles to gate inline product
    // creation: creating products is part of receiving — same grant, so the
    // flag simply mirrors `can_receive` (all-or-nothing).
    can_create_products: hasPermission(req.user, 'inventory_receive'),
    can_reorder: hasPermission(req.user, 'reorder_create'),
    can_manage_reorders: hasPermission(req.user, 'reorder_manage'),
  });
});

// Server-computed default title for a new reorder list: Reorder - 20 Sep - 01.
router.get('/reorders/next-ref', async (req, res) => {
  res.json({ title: await nextReorderRef() });
});

// Per-status counts powering the filter-button badges (Pending / Processing / Fulfilled).
router.get('/reorders/counts', async (req, res) => {
  const rows = await many(`SELECT status, COUNT(*)::int AS count FROM reorder_lists GROUP BY status`);
  const counts = { pending: 0, processed: 0, fulfilled: 0, cancelled: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] = row.count;
  res.json({ counts });
});

for (const [path, table] of [['consignments', 'consignments'], ['reorders', 'reorder_lists']]) {
  // Deliveries move real stock: receiving is manager-only, although the admin
  // may elevate a trusted operator with an explicit `inventory_receive` grant.
  // Reorder lists are a drafting tool every POS role may read (and, with the
  // reorder_create grant, write) — never touching stock.
  const listGuard = path === 'consignments' ? requirePermission('inventory_receive') : (req, res, next) => next();
  const saveGuard = path === 'consignments' ? requirePermission('inventory_receive') : requirePermission('reorder_create');

  router.get(`/${path}`, listGuard, async (req, res) => {
    // Only active lists (pending + processed) are due for fulfillment. Fulfilled lists
    // are history (traceable via their consignment); cancelled are retired. Fulfilled
    // history stays reachable via the admin filter buttons (?status=fulfilled).
    // Omitting ?status=, ?status=active, or ?status=all all return active lists.
    const params = [];
    let where = '';
    if (path === 'reorders') {
      const raw = String(req.query.status || '').toLowerCase();
      const allowed = ['pending', 'processed', 'fulfilled', 'cancelled'];
      if (raw === '' || raw === 'active' || raw === 'all') {
        where = `WHERE r.status IN ('pending','processed')`;
      } else if (allowed.includes(raw)) {
        where = 'WHERE r.status = $1';
        params.push(raw);
      } else {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
    }
    const records = await many(
      `SELECT r.*, u.full_name AS created_by_name FROM ${table} r JOIN users u ON u.id=r.created_by ${where} ORDER BY r.created_at DESC LIMIT 100`,
      params,
    );
    res.json({ records });
  });

  router.post(`/${path}`, saveGuard, async (req, res, next) => {
    try {
      const body = req.body || {};
      // Safety net: an empty reorder title gets the server-generated default
      // (e.g. Reorder - 20 Sep - 01).
      if (table === 'reorder_lists' && !String(body.title || '').trim()) {
        body.title = await nextReorderRef();
      }
      const result = await save(table, body, req.user);
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });
}

// Update reorder list status (pending | processed | fulfilled | cancelled).
// 'fulfilled' is normally set server-side by the POS receive flow, but admins
// can also fulfil a list directly from the dashboard.
router.patch('/reorders/:id/status', requirePermission('reorder_manage'), async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;
  const valid = ['pending', 'processed', 'fulfilled', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    // Read first so we can tell the creator about the change (and skip no-ops).
    const row = await one(`SELECT title, created_by, status FROM reorder_lists WHERE id = $1`, [id]);
    if (status === 'fulfilled') {
      // Mirror the receive flow: stamp fulfilled/fulfilled_at and write the audit entry.
      await many(
        `UPDATE reorder_lists
         SET status = 'fulfilled', fulfilled = TRUE, fulfilled_at = COALESCE(fulfilled_at, now()), updated_at = now()
         WHERE id = $1`,
        [id],
      );
      await many('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, $2, $3, $4)', [
        req.user.id,
        'fulfill_reorder',
        'reorder_lists',
        id,
      ]);
    } else {
      await many('UPDATE reorder_lists SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
    }
    // Phase 2: whoever created the list hears about admin status changes
    // (their own actions never bounce back to them).
    if (row && row.status !== status && row.created_by && row.created_by !== req.user.id) {
      setImmediate(() => notifyUser(row.created_by, reorderStatus({ id, title: row.title }, status)).catch(() => {}));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
