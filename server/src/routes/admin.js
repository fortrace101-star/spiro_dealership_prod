const express = require('express');
const crypto = require('crypto');
const { one, many, query, pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { audit } = require('../middleware/audit');
const { verifyPassword } = require('../auth');

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
      [p.sku, p.barcode || null, p.name, p.category || 'Spare Parts', p.brand || null, p.supplier || null,
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

// ---------- Bike reservations & installments (admin) ----------
// Reserve an E-bike for a customer with a down payment, then track each
// installment until the bike is paid off completely. While an order is active
// the bike is 'reserved'; once the balance reaches zero it flips to 'sold';
// a 'released' reservation puts the bike back to 'in_stock'.
const RES_SELECT = `
  SELECT r.*, u.full_name AS reserved_by_name,
         b.vin, b.model, b.color, b.year, b.status AS bike_status, b.selling_price,
         c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
         c.address AS customer_address, c.notes AS customer_notes
`;
const RES_FROM = `
  FROM bike_reservations r
  JOIN bikes b ON b.id = r.bike_id
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users u ON u.id = r.reserved_by
`;

// FOR UPDATE queries lock the bike_reservations row (r) only. RES_SELECT needs
// the LEFT JOIN to users for u.full_name, and PostgreSQL refuses a bare
// FOR UPDATE on an outer join (0A000), so these call sites MUST use
// "FOR UPDATE OF r" — never a plain "FOR UPDATE".
const RES_FROM_FOR_UPDATE = `
  FROM bike_reservations r
  JOIN bikes b ON b.id = r.bike_id
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users u ON u.id = r.reserved_by
`;

function shapeReservation(r) {
  const payments = (Array.isArray(r.reservations_payments) ? r.reservations_payments : []).map((p) => ({
    id: p.id, reservation_id: p.reservation_id, amount: Number(p.amount),
    payment_method: p.payment_method, paid_by: p.paid_by, paid_by_name: p.paid_by_name,
    transaction_ref: p.transaction_ref, note: p.note, created_at: p.created_at,
  }));
  return {
    id: r.id, bike_id: r.bike_id, customer_id: r.customer_id,
    reserved_by: r.reserved_by, reserved_by_name: r.reserved_by_name,
    reserved_at: r.reserved_at, total_price: Number(r.total_price), down_payment: Number(r.down_payment),
    balance: Number(r.balance), plan_months: Number(r.plan_months), status: r.status, notes: r.notes,
    completed_at: r.completed_at, released_at: r.released_at,
    created_at: r.created_at, updated_at: r.updated_at,
    bike: r.vin != null ? { id: r.bike_id, vin: r.vin, model: r.model, color: r.color, status: r.bike_status, selling_price: Number(r.selling_price) } : undefined,
    customer: r.customer_name != null ? { id: r.customer_id, full_name: r.customer_name, phone: r.customer_phone, email: r.customer_email, address: r.customer_address, notes: r.customer_notes } : undefined,
    reservations_payments: payments,
  };
}

// Single reservation with its payment trail (used by detail + after mutations)
async function fetchReservation(id) {
  const r = await one(`${RES_SELECT}${RES_FROM} WHERE r.id = $1`, [id]);
  if (!r) return null;
  const payments = await many(
    `SELECT p.*, u.full_name AS paid_by_name
       FROM bike_installment_payments p LEFT JOIN users u ON u.id = p.paid_by
      WHERE p.reservation_id = $1 ORDER BY p.created_at`,
    [id],
  );
  return shapeReservation({ ...r, reservations_payments: payments });
}

// List reservations (status defaults to 'active'), optionally searching VIN/customer.
router.get('/reservations', requireRole(), async (req, res) => {
  const { status = 'active', q = '' } = req.query;
  const params = [];
  let where = `WHERE 1=1`;
  if (status) {
    params.push(status);
    where += ` AND r.status = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (b.vin ILIKE $${params.length} OR b.model ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR COALESCE(c.phone,'') ILIKE $${params.length})`;
  }
  const reservations = await many(
    `${RES_SELECT},
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', p.id, 'reservation_id', p.reservation_id, 'amount', p.amount,
            'payment_method', p.payment_method, 'paid_by', p.paid_by, 'paid_by_name', pu.full_name,
            'transaction_ref', p.transaction_ref, 'note', p.note, 'created_at', p.created_at
          ) ORDER BY p.created_at)
          FROM bike_installment_payments p LEFT JOIN users pu ON pu.id = p.paid_by
          WHERE p.reservation_id = r.id
        ), '[]'::json) AS reservations_payments
     ${RES_FROM} ${where} ORDER BY r.reserved_at DESC LIMIT 200`,
    params,
  );
  res.json({ reservations: reservations.map(shapeReservation) });
});

// Reservation detail with full payment history.
router.get('/reservations/:id', requireRole(), async (req, res) => {
  const reservation = await fetchReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
  res.json({ reservation });
});

// Create a reservation: lock the bike, take the down payment, flip bike → 'reserved'.
router.post('/reservations', requireRole(), async (req, res) => {
  const { bike_id, customer_id, total_price, down_payment, plan_months, notes, payment_method, transaction_ref } = req.body || {};
  if (!bike_id || !customer_id) return res.status(400).json({ error: 'bike_id and customer_id required' });
  const tp = Number(total_price);
  const dp = Number(down_payment);
  const months = Number(plan_months) || 0;
  if (!Number.isFinite(tp) || tp < 0) return res.status(400).json({ error: 'total_price must be a positive number' });
  if (!Number.isFinite(dp) || dp <= 0) return res.status(400).json({ error: 'down_payment must be greater than 0' });
  if (dp > tp) return res.status(400).json({ error: 'down_payment cannot exceed total_price' });

  const client = await pool.connect();
  let reservationId;
  try {
    await client.query('BEGIN');
    const bike = await client.query(`SELECT id, status FROM bikes WHERE id = $1 FOR UPDATE`, [bike_id]);
    if (!bike.rows[0]) throw Object.assign(new Error('Bike not found'), { status: 404 });
    if (bike.rows[0].status !== 'in_stock') {
      throw Object.assign(new Error(`Bike is ${bike.rows[0].status}; only in-stock bikes can be reserved`), { status: 400 });
    }
    const customer = await client.query(`SELECT id FROM customers WHERE id = $1`, [customer_id]);
    if (!customer.rows[0]) throw Object.assign(new Error('Customer not found'), { status: 404 });

    const balance = tp - dp;
    const rec = await client.query(
      `INSERT INTO bike_reservations (bike_id, customer_id, reserved_by, total_price, down_payment, balance, plan_months, status, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'active', $8) RETURNING *`,
      [bike_id, customer_id, req.user.id, tp, dp, balance, months, notes || null],
    );
    const reservation = rec.rows[0];

    // The down payment is the first installment — record it so every coin is traceable.
    await client.query(
      `INSERT INTO bike_installment_payments (reservation_id, amount, payment_method, paid_by, transaction_ref, note)
        VALUES ($1,$2,$3,$4,$5,$6)`,
      [reservation.id, dp, payment_method || 'cash', req.user.id, transaction_ref || null, notes || null],
    );

    // A down payment that already covers the whole price means the bike is paid
    // off on the spot: close the reservation and mark the bike sold, rather than
    // leaving a zero-balance 'active' reservation to be completed by hand.
    if (balance <= 0.01) {
      await client.query(
        `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now()
          WHERE id = $1`,
        [reservation.id],
      );
      await client.query(
        `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2, updated_at = now()
          WHERE id = $3`,
        [tp, customer_id, bike_id],
      );
    } else {
      // Bike is only partially paid: flip it to 'reserved' so it can't be double-booked.
      await client.query(
        `UPDATE bikes SET status = 'reserved', reserved_at = now(), reserved_by = $1, updated_at = now()
          WHERE id = $2`,
        [req.user.id, bike_id],
      );
    }

    await audit({ userId: req.user.id, action: 'create_reservation', entity: 'bike_reservation', entityId: reservation.id, newValue: reservation });
    if (balance <= 0.01) {
      await audit({ userId: req.user.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: reservation.id, oldValue: { status: 'active' }, newValue: { status: 'completed', balance: 0, paid_in_full: true } });
    }
    await client.query('COMMIT');
    reservationId = reservation.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
    const reservation = await fetchReservation(reservationId);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found after create' });
  res.status(201).json({ reservation });
});

// Record an installment payment. When the balance clears the bike is paid off
// completely and the reservation + bike are marked 'completed'/'sold'.
router.post('/reservations/:id/payments', requireRole(), async (req, res) => {
  const { amount, payment_method, transaction_ref, note } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`${RES_SELECT}${RES_FROM_FOR_UPDATE} WHERE r.id = $1 FOR UPDATE OF r`, [req.params.id]);
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; payments can only be recorded on active reservations`), { status: 400 });
    }
    const outstanding = Number(resv.balance);
    if (amt > outstanding) throw Object.assign(new Error(`Payment exceeds outstanding balance (${outstanding})`), { status: 400 });

    const pay = await client.query(
      `INSERT INTO bike_installment_payments (reservation_id, amount, payment_method, paid_by, transaction_ref, note)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, reservation_id, amount, payment_method, paid_by, transaction_ref, note, created_at`,
      [req.params.id, amt, payment_method || 'cash', req.user.id, transaction_ref || null, note || null],
    );
    const payment = { ...pay.rows[0], amount: Number(pay.rows[0].amount) };

    const newBalance = outstanding - amt;
    const willComplete = newBalance <= 0.01;
    if (willComplete) {
      await client.query(
        `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now() WHERE id = $1`,
        [req.params.id],
      );
      await client.query(
        `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2 WHERE id = $3`,
        [resv.total_price, resv.customer_id, resv.bike_id],
      );
      await audit({ userId: req.user.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: req.params.id, oldValue: { status: resv.status }, newValue: { status: 'completed', balance: 0 } });
    } else {
      await client.query(
        `UPDATE bike_reservations SET balance = GREATEST(0, balance - $1), updated_at = now() WHERE id = $2`,
        [amt, req.params.id],
      );
    }
    await audit({ userId: req.user.id, action: 'record_installment', entity: 'bike_installment_payment', entityId: payment.id, newValue: payment });
    await client.query('COMMIT');

        const reservation = await fetchReservation(req.params.id);
    res.json({ payment, balance: willComplete ? 0 : newBalance, reservation });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
});

// Mark an active reservation as fully paid (only valid when balance = 0).
router.post('/reservations/:id/complete', requireRole(), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`${RES_SELECT}${RES_FROM_FOR_UPDATE} WHERE r.id = $1 FOR UPDATE OF r`, [req.params.id]);
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; only active reservations can be completed`), { status: 400 });
    }
    if (Number(resv.balance) > 0.01) {
      throw Object.assign(new Error(`Cannot complete reservation — balance of ${Number(resv.balance)} is still outstanding`), { status: 400 });
    }
    await client.query(
      `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now() WHERE id = $1`,
      [req.params.id],
    );
      await client.query(
      `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2 WHERE id = $3`,
      [resv.total_price, resv.customer_id, resv.bike_id],
    );
    await audit({ userId: req.user.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: req.params.id, oldValue: { status: resv.status }, newValue: { status: 'completed' } });
    await client.query('COMMIT');
    const reservation = await fetchReservation(req.params.id);
    res.json({ reservation });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
});

// Release an active reservation: the bike returns to 'in_stock' so it can be
// re-sold (the reservation is kept for history as 'released').
router.post('/reservations/:id/release', requireRole(), async (req, res) => {
  const { note, password } = req.body || {};
  // Identity check: releasing a reservation requires the acting user's own
  // password, verified server-side before any state is changed.
  const me = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!me || !(await verifyPassword(password || '', me.password_hash))) {
    return res.status(403).json({ error: 'Password verification failed' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT r.*, b.status AS bike_status FROM bike_reservations r JOIN bikes b ON b.id = r.bike_id WHERE r.id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; only active reservations can be released`), { status: 400 });
    }
    await client.query(
      `UPDATE bike_reservations SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1`,
      [req.params.id],
    );
    await client.query(
      `UPDATE bikes SET status = 'in_stock', reserved_at = NULL, reserved_by = NULL, updated_at = now() WHERE id = $1`,
      [resv.bike_id],
    );
    if (note) {
      await client.query(
        `UPDATE bike_reservations SET notes = CASE WHEN notes IS NULL OR notes = '' THEN $1 ELSE notes || E'\n' || $1 END WHERE id = $2`,
        [note, req.params.id],
      );
    }
    await audit({ userId: req.user.id, action: 'release_reservation', entity: 'bike_reservation', entityId: req.params.id, oldValue: { status: resv.status }, newValue: { status: 'released', note: note || null } });
    await client.query('COMMIT');
    const reservation = await fetchReservation(req.params.id);
    res.json({ reservation });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
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
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = 'WHERE a.status = $1';
  }
  const approvals = await many(
    `SELECT a.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
       FROM approvals a
       LEFT JOIN users u ON u.id = a.requested_by
       LEFT JOIN users d ON d.id = a.decided_by
      ${where} ORDER BY a.created_at DESC LIMIT 200`, params
  );
  res.json({ approvals });
});

router.post('/approvals/:id/decide', requireRole(), async (req, res) => {
  const { decision, note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'decision must be approved|rejected' });

  // Approving a reservation release executes the release first — the decision
  // only lands if the bike actually returns to stock (it may already be gone).
  if (decision === 'approved') {
    const prior = await one('SELECT type, payload FROM approvals WHERE id = $1', [req.params.id]);
    if (prior && prior.type === 'reservation_release') {
      try {
        const { releaseReservation } = require('../services/reservations');
        await releaseReservation((prior.payload || {}).reservation_id, { note: note || null }, req.user);
      } catch (err) {
        return res.status(err.status || 409).json({ error: `Release failed: ${err.message}` });
      }
    }
  }

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
