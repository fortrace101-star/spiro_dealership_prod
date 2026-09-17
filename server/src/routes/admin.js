const express = require('express');
const crypto = require('crypto');
const { one, many, query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { audit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

/** Whitelist of POS capabilities that can be granted beyond a user's role. */
const POS_PERMISSIONS = ['inventory_entry'];

// ---------- Activation codes (admin) ----------
router.get('/codes', requireRole(), async (req, res) => {
  const codes = await many(
    `SELECT c.*, u1.full_name AS created_by_name, u2.full_name AS claimed_by_name
       FROM activation_codes c
       LEFT JOIN users u1 ON u1.id = c.created_by
       LEFT JOIN users u2 ON u2.id = c.claimed_by
      ORDER BY c.created_at DESC LIMIT 100`
  );
  res.json({ codes });
});

router.post('/codes', requireRole(), async (req, res) => {
  const { label, role = 'cashier', days = 7, permissions } = req.body || {};
  const code = 'SPIRO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  // Whitelist of grantable POS permissions (extra capabilities beyond the role).
  const allowed = POS_PERMISSIONS;
  const perms = Array.isArray(permissions) ? permissions.filter((p) => allowed.includes(p)) : [];
  const rec = await one(
    `INSERT INTO activation_codes (code, label, role, permissions, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval) RETURNING *`,
    [code, label || null, ['manager', 'cashier', 'mechanic'].includes(role) ? role : 'cashier', JSON.stringify(perms), req.user.id, String(days)]
  );
  await audit({ userId: req.user.id, action: 'create_code', entity: 'activation_code', entityId: rec.id, newValue: rec });
  res.status(201).json({ code: rec });
});

router.delete('/codes/:id', requireRole(), async (req, res) => {
  const rec = await one(`DELETE FROM activation_codes WHERE id = $1 AND used_at IS NULL RETURNING id`, [req.params.id]);
  if (!rec) return res.status(400).json({ error: 'Code not found or already used' });
  await audit({ userId: req.user.id, action: 'revoke_code', entity: 'activation_code', entityId: rec.id });
  res.json({ ok: true });
});

// ---------- Users (admin) ----------
router.patch('/users/:id', requireRole(), async (req, res) => {
  const { is_active, role, permissions } = req.body || {};
  const before = await one(`SELECT * FROM users WHERE id = $1`, [req.params.id]);
  if (!before) return res.status(404).json({ error: 'User not found' });

  // An existing operator can be granted or stripped of POS capabilities without a
  // new activation code. Only whitelisted values are stored, deduped and bounded.
  let perms = null;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions) || permissions.length > POS_PERMISSIONS.length + 5) {
      return res.status(400).json({ error: 'permissions must be a list of known capabilities' });
    }
    perms = [...new Set(permissions.filter((p) => POS_PERMISSIONS.includes(p)))];
  }

  const user = await one(
    `UPDATE users SET
       is_active = COALESCE($2, is_active),
       role = COALESCE($3, role),
       permissions = COALESCE($4, permissions)
     WHERE id = $1 RETURNING id, full_name, email, phone, role, permissions, is_active`,
    [req.params.id, is_active ?? null, role ?? null, perms ? JSON.stringify(perms) : null]
  );
  await audit({ userId: req.user.id, action: 'update_user', entity: 'user', entityId: user.id, oldValue: before, newValue: user });
  res.json({ user });
});

// ---------- Products (admin) ----------
// Write routes require the inventory_entry permission (admins/managers pass
// implicitly; other roles must have been granted it via their activation code).
router.get('/products', async (req, res) => {
  const { q, low_stock } = req.query;
  const params = [];
  let where = `WHERE active = TRUE`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (name ILIKE $${params.length} OR sku ILIKE $${params.length} OR barcode ILIKE $${params.length} OR COALESCE(brand,'') ILIKE $${params.length})`;
  }
  if (low_stock === '1') where += ` AND stock_qty <= reorder_level`;
  const products = await many(
    `SELECT *, (stock_qty * cost_price) AS stock_value FROM products ${where} ORDER BY name LIMIT 500`, params
  );
  res.json({ products });
});

router.post('/products', requireRole(), requirePermission('inventory_entry'), async (req, res) => {
  try {
    const p = req.body || {};
    if (!p.sku || !p.name) return res.status(400).json({ error: 'sku and name required' });
    const rec = await one(
      `INSERT INTO products (sku, barcode, name, category, brand, supplier, cost_price, selling_price, stock_qty, min_stock, reorder_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [p.sku, p.barcode || null, p.name, p.category || 'Spare part', p.brand || null, p.supplier || null,
       Number(p.cost_price) || 0, Number(p.selling_price) || 0, Number(p.stock_qty) || 0,
       Number(p.min_stock) || 5, Number(p.reorder_level) || 10]
    );
    if (Number(p.stock_qty) > 0) {
      await one(`INSERT INTO stock_movements (product_id, qty, type, user_id, note) VALUES ($1,$2,'purchase',$3,'Opening stock')`,
        [rec.id, Number(p.stock_qty), req.user.id]);
    }
    await audit({ userId: req.user.id, action: 'create_product', entity: 'product', entityId: rec.id, newValue: rec });
    res.status(201).json({ product: rec });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU or barcode already exists' });
    throw err;
  }
});

router.put('/products/:id', requireRole(), requirePermission('inventory_entry'), async (req, res) => {
  const before = await one(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
  if (!before) return res.status(404).json({ error: 'Product not found' });
  const p = { ...before, ...req.body };
  const rec = await one(
    `UPDATE products SET sku=$2, barcode=$3, name=$4, category=$5, brand=$6, supplier=$7,
       cost_price=$8, selling_price=$9, min_stock=$10, reorder_level=$11, active=$12, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [req.params.id, p.sku, p.barcode || null, p.name, p.category, p.brand || null, p.supplier || null,
     Number(p.cost_price) || 0, Number(p.selling_price) || 0, Number(p.min_stock) || 5,
     Number(p.reorder_level) || 10, p.active !== false]
  );
  await audit({ userId: req.user.id, action: 'update_product', entity: 'product', entityId: rec.id, oldValue: before, newValue: rec });
  res.json({ product: rec });
});

// ---------- Bikes (admin) ----------
router.get('/bikes', async (req, res) => {
  const { q, status } = req.query;
  const params = [];
  let where = `WHERE 1=1`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (vin ILIKE $${params.length} OR model ILIKE $${params.length} OR COALESCE(motor_number,'') ILIKE $${params.length} OR COALESCE(battery_serial,'') ILIKE $${params.length})`;
  }
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const bikes = await many(
    `SELECT b.*, c.full_name AS customer_name
       FROM bikes b LEFT JOIN customers c ON c.id = b.customer_id
      ${where} ORDER BY b.received_at DESC LIMIT 500`, params
  );
  res.json({ bikes });
});

router.post('/bikes', requireRole(), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.vin || !b.model) return res.status(400).json({ error: 'vin and model required' });
    const rec = await one(
      `INSERT INTO bikes (vin, model, color, year, motor_number, battery_serial, battery_spec, odometer_km, cost_price, selling_price, status, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.vin, b.model, b.color || null, b.year ? Number(b.year) : null, b.motor_number || null,
       b.battery_serial || null, b.battery_spec || null, Number(b.odometer_km) || 0,
       Number(b.cost_price) || 0, Number(b.selling_price) || 0, b.status || 'in_stock', b.location || null]
    );
    await audit({ userId: req.user.id, action: 'create_bike', entity: 'bike', entityId: rec.id, newValue: rec });
    res.status(201).json({ bike: rec });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'VIN already exists' });
    throw err;
  }
});

router.put('/bikes/:id', requireRole(), async (req, res) => {
  const before = await one(`SELECT * FROM bikes WHERE id = $1`, [req.params.id]);
  if (!before) return res.status(404).json({ error: 'Bike not found' });
  const b = { ...before, ...req.body };
  const rec = await one(
    `UPDATE bikes SET vin=$2, model=$3, color=$4, year=$5, motor_number=$6, battery_serial=$7,
       battery_spec=$8, odometer_km=$9, cost_price=$10, selling_price=$11, status=$12, location=$13, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [req.params.id, b.vin, b.model, b.color || null, b.year ? Number(b.year) : null,
     b.motor_number || null, b.battery_serial || null, b.battery_spec || null,
     Number(b.odometer_km) || 0, Number(b.cost_price) || 0, Number(b.selling_price) || 0,
     b.status || 'in_stock', b.location || null]
  );
  await audit({ userId: req.user.id, action: 'update_bike', entity: 'bike', entityId: rec.id, oldValue: before, newValue: rec });
  res.json({ bike: rec });
});

/** VIN lookup — the "critical requirement" from the ERP brief */
router.get('/bikes/lookup/:vin', async (req, res) => {
  const bike = await one(
    `SELECT b.*, c.full_name AS customer_name, c.phone AS customer_phone
       FROM bikes b LEFT JOIN customers c ON c.id = b.customer_id
      WHERE upper(b.vin) = upper($1)`, [req.params.vin]
  );
  if (!bike) return res.status(404).json({ error: 'VIN not found' });
  const sales = await many(
    `SELECT s.id, s.receipt_no, s.total, s.created_at, u.full_name AS cashier
       FROM sales s JOIN users u ON u.id = s.cashier_id
      WHERE s.bike_id = $1 ORDER BY s.created_at DESC`, [bike.id]
  );
  res.json({ bike, sales });
});

// ---------- Customers ----------
router.get('/customers', async (req, res) => {
  const { q } = req.query;
  const params = [];
  let where = `WHERE 1=1`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (full_name ILIKE $${params.length} OR COALESCE(phone,'') ILIKE $${params.length})`;
  }
  const customers = await many(
    `SELECT c.*,
            (SELECT count(*) FROM sales s WHERE s.customer_id = c.id) AS purchase_count,
            (SELECT COALESCE(sum(s.total),0) FROM sales s WHERE s.customer_id = c.id) AS lifetime_value
       FROM customers c ${where} ORDER BY c.created_at DESC LIMIT 200`, params
  );
  res.json({ customers });
});

router.post('/customers', async (req, res) => {
  try {
    const c = req.body || {};
    if (!c.full_name) return res.status(400).json({ error: 'full_name required' });
    const rec = await one(
      `INSERT INTO customers (full_name, phone, email, address, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [c.full_name, c.phone || null, c.email || null, c.address || null, c.notes || null]
    );
    await audit({ userId: req.user.id, action: 'create_customer', entity: 'customer', entityId: rec.id, newValue: rec });
    res.status(201).json({ customer: rec });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Phone already registered' });
    throw err;
  }
});

/** Customer 360: profile + bikes + purchase history */
router.get('/customers/:id', async (req, res) => {
  const customer = await one(`SELECT * FROM customers WHERE id = $1`, [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const bikes = await many(
    `SELECT cb.*, b.vin, b.model, b.color, b.year, b.status
       FROM customer_bikes cb LEFT JOIN bikes b ON b.id = cb.bike_id
      WHERE cb.customer_id = $1 ORDER BY cb.created_at DESC`, [req.params.id]
  );
  const purchases = await many(
    `SELECT s.id, s.receipt_no, s.total, s.payment_method, s.created_at, u.full_name AS cashier
       FROM sales s JOIN users u ON u.id = s.cashier_id
      WHERE s.customer_id = $1 ORDER BY s.created_at DESC`, [req.params.id]
  );
  res.json({ customer, bikes, purchases });
});

// ---------- Inventory adjustments (admin/manager) ----------
router.post('/inventory/adjust', requireRole(), requirePermission('inventory_entry'), async (req, res) => {
  const { product_id, qty, note, type = 'adjustment' } = req.body || {};
  const product = await one(`SELECT * FROM products WHERE id = $1`, [product_id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const delta = Number(qty);
  if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'qty must be a non-zero integer' });

  const newQty = product.stock_qty + delta;
  if (newQty < 0) return res.status(400).json({ error: `Resulting stock would be negative (${product.stock_qty} now)` });

  await one(`UPDATE products SET stock_qty = stock_qty + $2, updated_at = now() WHERE id = $1`, [product_id, delta]);
  const mv = await one(
    `INSERT INTO stock_movements (product_id, qty, type, user_id, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [product_id, delta, ['purchase', 'adjustment', 'damaged', 'workshop', 'transfer', 'return'].includes(type) ? type : 'adjustment',
     req.user.id, note || null]
  );
  await audit({ userId: req.user.id, action: 'stock_adjustment', entity: 'product', entityId: product_id,
    oldValue: { stock_qty: product.stock_qty }, newValue: { stock_qty: newQty }, meta: { note } });
  res.status(201).json({ movement: mv, stock_qty: newQty });
});

router.get('/inventory/movements', async (req, res) => {
  const { product_id, limit = 200 } = req.query;
  const params = [];
  let where = `WHERE 1=1`;
  if (product_id) {
    params.push(product_id);
    where += ` AND m.product_id = $${params.length}`;
  }
  const movements = await many(
    `SELECT m.*, p.name AS product_name, p.sku, u.full_name AS user_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
      ${where} ORDER BY m.created_at DESC LIMIT ${Number(limit) || 200}`, params
  );
  res.json({ movements });
});

// ---------- Approvals (admin/manager) ----------
router.get('/approvals', requireRole(), async (req, res) => {
  const { status = 'pending' } = req.query;
  const approvals = await many(
    `SELECT a.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
       FROM approvals a
       LEFT JOIN users u ON u.id = a.requested_by
       LEFT JOIN users d ON d.id = a.decided_by
      WHERE a.status = $1 ORDER BY a.created_at DESC LIMIT 200`, [status]
  );
  res.json({ approvals });
});

router.post('/approvals/:id/decide', requireRole(), async (req, res) => {
  const { decision, note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected' });

  const rec = await one(
    `UPDATE approvals SET status=$2, decided_by=$3, decided_at=now(), note=$4
     WHERE id=$1 AND status='pending' RETURNING *`,
    [req.params.id, decision, req.user.id, note || null]
  );
  if (!rec) return res.status(400).json({ error: 'Approval not found or already decided' });
  await audit({ userId: req.user.id, action: `approval_${decision}`, entity: 'approval', entityId: rec.id, newValue: rec });
  res.json({ approval: rec });
});

// ---------- DEV ONLY: wipe all transactional + demo data ----------
// Used by the "Dev: reset data" button in the admin sidebar while testing.
// Admin-only, requires an explicit confirm flag, and keeps the calling admin
// logged in (their user row and their push subscription survive the wipe).
router.post('/dev/wipe', requireRole(), async (req, res) => {
  if (req.body?.confirm !== 'WIPE') {
    return res.status(400).json({ error: 'Send { confirm: "WIPE" } to confirm data erasure' });
  }

  try {
    // Quote identifiers — TRUNCATE takes a list, not parameters.
    await query(
      `TRUNCATE audit_log, push_subscriptions, stock_movements, sale_items, sales,
              approvals, customer_bikes, activation_codes
       RESTART IDENTITY CASCADE`
    );

    // Bikes reference customers → clear the link, then delete both.
    await query(`UPDATE bikes SET customer_id = NULL`);
    await query(`DELETE FROM bikes`);
    await query(`DELETE FROM products`);
    await query(`DELETE FROM customers`);

    // Keep the caller (the admin using the button) but drop every other account.
    await query(`DELETE FROM users WHERE id <> $1`, [req.user.id]);

    await audit({
      userId: req.user.id,
      action: 'dev_wipe_database',
      entity: 'database',
      entityId: null,
      meta: { at: new Date().toISOString() },
    });

    console.log(`[dev] database wiped by ${req.user.full_name} (${req.user.email}) at ${new Date().toISOString()}`);
    res.json({ ok: true, wiped: true, kept_user: req.user.id });
  } catch (err) {
    console.error('[dev/wipe] failed:', err.message);
    res.status(500).json({ error: 'Wipe failed: ' + err.message });
  }
});

// ---------- Audit log (admin) ----------
router.get('/audit', requireRole(), async (req, res) => {
  const { limit = 300 } = req.query;
  const entries = await many(
    `SELECT a.*, u.full_name AS user_name, u.role AS user_role
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT ${Number(limit) || 300}`
  );
  res.json({ entries });
});

// ---------- Push subscription management ----------
router.get('/subscriptions', requireRole(), async (req, res) => {
  const subs = await many(
    `SELECT s.id, s.endpoint, s.user_agent, s.created_at, u.full_name AS user_name
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC`
  );
  res.json({ subscriptions: subs });
});

router.delete('/subscriptions/:id', requireRole(), async (req, res) => {
  await many(`DELETE FROM push_subscriptions WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

/** Test notification button */
router.post('/push/test', requireRole(), async (req, res) => {
  const push = require('../services/push');
  const ok = push.ensureConfigured();
  if (!ok) return res.status(400).json({ error: 'VAPID keys not configured on server' });
  await push.notifyAdmins({ title: '🔔 Spiro Test', body: 'Web Push is working!', url: '/' });
  res.json({ ok: true });
});

module.exports = router;
