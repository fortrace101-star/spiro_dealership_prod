const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { audit } = require('../middleware/audit');
const { recordSale } = require('../services/sales');
const {
  listReservations,
  fetchReservation,
  createReservation,
  recordInstallment,
  completeReservation,
  releaseReservation,
  findOrCreateCustomer,
} = require('../services/reservations');

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

// ---------- Bike reservations & installments (POS, cashier-accessible) ----------
// Reservations need live row-level locking on the bike (they can never queue
// offline like sales), so every mutation here requires network access and runs
// in the same transactional service as the admin back-office.

/** List reservations (status defaults to 'active'), searching VIN/model/customer. */
router.get('/reservations', async (req, res) => {
  try {
    const reservations = await listReservations({ status: req.query.status ?? 'active', q: req.query.q || '' });
    res.json({ reservations });
  } catch (err) {
    console.error('[pos/reservations] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load reservations' });
  }
});

/** Single reservation with its payment trail. */
router.get('/reservations/:id', async (req, res) => {
  try {
    const reservation = await fetchReservation(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    res.json({ reservation });
  } catch (err) {
    console.error('[pos/reservations] detail failed:', err.message);
    res.status(500).json({ error: 'Failed to load reservation' });
  }
});

/**
 * Reserve a bike after a down payment. The POS sends either an existing
 * customer_id or a name + phone pair (we create/attach the customer by phone,
 * mirroring the sales flow — cashiers must not juggle customer UUIDs).
 */
router.post('/reservations', async (req, res) => {
  try {
    const { bike_id, customer_id, customer_name, customer_phone, total_price, down_payment, plan_months, notes, payment_method, transaction_ref } = req.body || {};
    let cid = customer_id || null;
    if (!cid) {
      if (!customer_name || !customer_phone) return res.status(400).json({ error: 'customer_id or customer_name + customer_phone required' });
      cid = await findOrCreateCustomer({ full_name: customer_name, phone: customer_phone });
    }
    const reservation = await createReservation(
      { bike_id, customer_id: cid, total_price, down_payment, plan_months, notes, payment_method, transaction_ref },
      req.user,
    );
    res.status(201).json({ reservation });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[pos/reservations] create failed:', err);
    res.status(500).json({ error: 'Failed to create reservation' });
  }
});

/** Record an installment payment (auto-completes + sells the bike at balance 0). */
router.post('/reservations/:id/payments', async (req, res) => {
  try {
    const { amount, payment_method, transaction_ref, note } = req.body || {};
    const result = await recordInstallment(req.params.id, { amount, payment_method, transaction_ref, note }, req.user);
    res.status(201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[pos/reservations] payment failed:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

/** Mark an active zero-balance reservation as fully paid (bike becomes sold). */
router.post('/reservations/:id/complete', async (req, res) => {
  try {
    const reservation = await completeReservation(req.params.id, req.user);
    res.json({ reservation });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[pos/reservations] complete failed:', err);
    res.status(500).json({ error: 'Failed to complete reservation' });
  }
});

/**
 * Release an active reservation (bike returns to in_stock).
 * Managers/admins and cashiers granted the inventory_entry permission release
 * immediately; anyone else raises a reservation_release approval that the
 * back-office decides on — the reservation stays active until approved.
 */
router.post('/reservations/:id/release', async (req, res) => {
  try {
    const note = (req.body || {}).note || null;
    const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const canRelease =
      req.user.role === 'admin' || req.user.role === 'manager' || perms.includes('inventory_entry');

    if (!canRelease) {
      const detail = await one(
        `SELECT r.balance, r.total_price, b.vin, b.model, c.full_name AS customer_name
           FROM bike_reservations r
           JOIN bikes b ON b.id = r.bike_id
           LEFT JOIN customers c ON c.id = r.customer_id
          WHERE r.id = $1`, [req.params.id]
      );
      if (!detail) return res.status(404).json({ error: 'Reservation not found' });
      const approval = await one(
        `INSERT INTO approvals (type, requested_by, payload, status)
         VALUES ('reservation_release', $1, $2, 'pending') RETURNING *`,
        [req.user.id, JSON.stringify({
          reservation_id: req.params.id,
          vin: detail.vin,
          model: detail.model,
          customer_name: detail.customer_name,
          balance: Number(detail.balance),
          total_price: Number(detail.total_price),
          note,
        })]
      );
      await audit({ userId: req.user.id, action: 'reservation_release_requested', entity: 'bike_reservations', entityId: req.params.id, newValue: approval });
      return res.status(202).json({ pendingApproval: true, approval, message: 'Release request sent for admin approval' });
    }

    const reservation = await releaseReservation(req.params.id, { note }, req.user);
    res.json({ reservation });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[pos/reservations] release failed:', err);
    res.status(500).json({ error: 'Failed to release reservation' });
  }
});

module.exports = router;
