const { pool, one, many } = require('../db');
const { audit } = require('../middleware/audit');
const pushSvc = require('./push');

/**
 * Shared reservation + installment logic used by BOTH the admin back-office
 * and the POS cashier endpoints. Keeping it here (instead of duplicating in
 * two route files) guarantees identical money behavior on both surfaces.
 *
 * Data model:
 *   bike_reservations        — one row per bike/customer plan
 *   bike_installment_payments — one row per payment (down payment is #1)
 *
 * Lifecycle: active --(balance hits 0)--> completed / bike sold
 *            active --(cancelled)-------> released / bike back in_stock
 */

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

/** Lock-only variant of RES_FROM: used by FOR UPDATE queries.
 * LEFT JOINs don't play well with FOR UPDATE, so this strips the user
 * join and only locks the reservation + its bike/customer joins. */
const RES_FROM_FOR_UPDATE = `
  FROM bike_reservations r
  JOIN bikes b ON b.id = r.bike_id
  JOIN customers c ON c.id = r.customer_id
`;

/** Single reservation with its payment trail (used by detail + after mutations). */
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

/** List reservations (status filter + VIN/model/customer search). */
async function listReservations({ status = 'active', q = '' } = {}) {
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
  const rows = await many(
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
  return rows.map(shapeReservation);
}

/**
 * Create a reservation: lock the bike, take the down payment, flip bike to
 * 'reserved'. The down payment is recorded as the first installment row so
 * every coin is traceable.
 * Throws { status, message } errors for the route layer to map to HTTP codes.
 */
async function createReservation(input, actor) {
  const { bike_id, customer_id, total_price, down_payment, plan_months, notes, payment_method, transaction_ref } = input || {};
  if (!bike_id || !customer_id) throw Object.assign(new Error('bike_id and customer_id required'), { status: 400 });
  const tp = Number(total_price);
  const dp = Number(down_payment);
  const months = Number(plan_months) || 0;
  if (!Number.isFinite(tp) || tp < 0) throw Object.assign(new Error('total_price must be a positive number'), { status: 400 });
  if (!Number.isFinite(dp) || dp <= 0) throw Object.assign(new Error('down_payment must be greater than 0'), { status: 400 });
  if (dp > tp) throw Object.assign(new Error('down_payment cannot exceed total_price'), { status: 400 });

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
      [bike_id, customer_id, actor.id, tp, dp, balance, months, notes || null],
    );
    const reservation = rec.rows[0];

    await client.query(
      `INSERT INTO bike_installment_payments (reservation_id, amount, payment_method, paid_by, transaction_ref, note)
        VALUES ($1,$2,$3,$4,$5,$6)`,
      [reservation.id, dp, payment_method || 'cash', actor.id, transaction_ref || null, notes || null],
    );

    // A down payment that already covers the whole price means the bike is paid
    // off on the spot: close the reservation and mark the bike sold, rather than
    // leaving a zero-balance 'active' reservation for someone to complete by hand.
    if (balance <= 0.01) {
      await client.query(
        `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now() WHERE id = $1`,
        [reservation.id],
      );
      await client.query(
        `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2, updated_at = now() WHERE id = $3`,
        [tp, customer_id, bike_id],
      );
    } else {
      // Flip the bike to 'reserved' so it can't be double-booked.
      await client.query(
        `UPDATE bikes SET status = 'reserved', reserved_at = now(), reserved_by = $1, updated_at = now()
          WHERE id = $2`,
        [actor.id, bike_id],
      );
    }

    await audit({ userId: actor.id, action: 'create_reservation', entity: 'bike_reservation', entityId: reservation.id, newValue: reservation });
    if (balance <= 0.01) {
      await audit({ userId: actor.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: reservation.id, oldValue: { status: 'active' }, newValue: { status: 'completed', balance: 0, paid_in_full: true } });
    }
    await client.query('COMMIT');
    reservationId = reservation.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const reservation = await fetchReservation(reservationId);
  if (!reservation) throw Object.assign(new Error('Reservation not found after create'), { status: 404 });
  // Merged day-one notice: reservation + down payment (first installment) in
  // one row — no duplicate "created" + "first installment" pair.
  setImmediate(() => pushSvc.notifyAdmins(pushSvc.reservationCreated(reservation)).catch(() => {}));
  return reservation;
}

/**
 * Record an installment payment against an active reservation. When the
 * balance clears, the reservation is completed and the bike flips to 'sold'.
 */
async function recordInstallment(id, input, actor) {
  const { amount, payment_method, transaction_ref, note } = input || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw Object.assign(new Error('amount must be greater than 0'), { status: 400 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(RES_SELECT + RES_FROM + ' WHERE r.id = $1', [id]);
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; payments can only be recorded on active reservations`), { status: 400 });
    }

    // Lock only the reservation row (FOR UPDATE over a LEFT JOIN in RES_FROM
    // triggers "cannot use FOR UPDATE on a view/negative join" errors in some PG
    // versions). We already have the joined row from the previous query above.
    const lock = await client.query('SELECT id FROM bike_reservations WHERE id = $1 FOR UPDATE', [id]);
    if (!lock.rows[0]) throw Object.assign(new Error('Reservation vanished — rolled back'), { status: 409 });
    const outstanding = Number(resv.balance);
    if (amt > outstanding) {
      throw Object.assign(new Error(`Payment exceeds outstanding balance (${outstanding})`), { status: 400 });
    }

    const pay = await client.query(
      `INSERT INTO bike_installment_payments (reservation_id, amount, payment_method, paid_by, transaction_ref, note)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, reservation_id, amount, payment_method, paid_by, transaction_ref, note, created_at`,
      [id, amt, payment_method || 'cash', actor.id, transaction_ref || null, note || null],
    );
    const payment = { ...pay.rows[0], amount: Number(pay.rows[0].amount) };

    const newBalance = outstanding - amt;
    const willComplete = newBalance <= 0.01;
    if (willComplete) {
      await client.query(
        `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2, updated_at = now() WHERE id = $3`,
        [resv.total_price, resv.customer_id, resv.bike_id],
      );
      await audit({ userId: actor.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: id, oldValue: { status: resv.status }, newValue: { status: 'completed', balance: 0 } });
    } else {
      await client.query(
        `UPDATE bike_reservations SET balance = GREATEST(0, balance - $1), updated_at = now() WHERE id = $2`,
        [amt, id],
      );
    }
    await audit({ userId: actor.id, action: 'record_installment', entity: 'bike_installment_payment', entityId: payment.id, newValue: payment });
    await client.query('COMMIT');

    const reservation = await fetchReservation(id);
    // Single funnel after COMMIT: admins/managers get the balance/progress
    // notice; a POS operator (not in that audience) gets their own ✅
    // self-confirmation on their device — the durable "it actually saved".
    const finalBalance = willComplete ? 0 : newBalance;
    setImmediate(() => {
      pushSvc.notifyAdmins(pushSvc.installmentReceived(reservation, amt, finalBalance, actor.full_name)).catch(() => {});
      if (String(actor.role) === 'operator') {
        pushSvc.notifyUser(actor.id, pushSvc.installmentSelf(reservation, amt, finalBalance)).catch(() => {});
      }
    });
    return { payment, balance: finalBalance, reservation };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Mark an active reservation as fully paid (only valid when balance = 0). */
async function completeReservation(id, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`${RES_SELECT}${RES_FROM} WHERE r.id = $1`, [id]);
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; only active reservations can be completed`), { status: 400 });
    }
    if (Number(resv.balance) > 0.01) {
      throw Object.assign(new Error(`Cannot complete reservation — balance of ${Number(resv.balance)} is still outstanding`), { status: 400 });
    }

    // Same FOR-UPDATE-safe split: lock the reservation row itself (no LEFT JOIN).
    const lock = await client.query('SELECT id FROM bike_reservations WHERE id = $1 FOR UPDATE', [id]);
    if (!lock.rows[0]) throw Object.assign(new Error('Reservation vanished — rolled back'), { status: 409 });
    await client.query(
      `UPDATE bike_reservations SET status = 'completed', balance = 0, completed_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    await client.query(
      `UPDATE bikes SET status = 'sold', sold_at = now(), sold_price = $1, customer_id = $2, updated_at = now() WHERE id = $3`,
      [resv.total_price, resv.customer_id, resv.bike_id],
    );
    await audit({ userId: actor.id, action: 'complete_reservation', entity: 'bike_reservation', entityId: id, oldValue: { status: resv.status }, newValue: { status: 'completed' } });
    await client.query('COMMIT');
    return fetchReservation(id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Release an active reservation: bike returns to in_stock; history kept as 'released'. */
async function releaseReservation(id, { note } = {}, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT r.*, b.status AS bike_status FROM bike_reservations r JOIN bikes b ON b.id = r.bike_id WHERE r.id = $1 FOR UPDATE`,
      [id],
    );
    if (!r.rows[0]) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const resv = r.rows[0];
    if (resv.status !== 'active') {
      throw Object.assign(new Error(`Reservation is ${resv.status}; only active reservations can be released`), { status: 400 });
    }
    await client.query(
      `UPDATE bike_reservations SET status = 'released', released_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    await client.query(
      `UPDATE bikes SET status = 'in_stock', reserved_at = NULL, reserved_by = NULL, updated_at = now() WHERE id = $1`,
      [resv.bike_id],
    );
    if (note) {
      await client.query(
        `UPDATE bike_reservations SET notes = CASE WHEN notes IS NULL OR notes = '' THEN $1 ELSE notes || E'\n' || $1 END WHERE id = $2`,
        [note, id],
      );
    }
    await audit({ userId: actor.id, action: 'release_reservation', entity: 'bike_reservation', entityId: id, oldValue: { status: resv.status }, newValue: { status: 'released', note: note || null } });
    await client.query('COMMIT');
    return fetchReservation(id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Find a customer by phone or create one — mirrors the sales flow so cashiers
 * never juggle customer UUIDs at the counter.
 */
async function findOrCreateCustomer({ full_name, phone }) {
  const cleanPhone = String(phone || '').trim();
  const cleanName = String(full_name || '').trim();
  if (!cleanName) throw Object.assign(new Error('Customer name is required'), { status: 400 });
  if (!cleanPhone) throw Object.assign(new Error('Customer phone is required'), { status: 400 });

  const existing = await one(`SELECT id FROM customers WHERE phone = $1 LIMIT 1`, [cleanPhone]);
  if (existing) return existing.id;

  const rec = await one(
    `INSERT INTO customers (full_name, phone) VALUES ($1, $2) RETURNING id`,
    [cleanName, cleanPhone],
  );
  await audit({ userId: null, action: 'create_customer', entity: 'customer', entityId: rec.id, newValue: { full_name: cleanName, phone: cleanPhone } });
  return rec.id;
}

module.exports = {
  listReservations,
  fetchReservation,
  createReservation,
  recordInstallment,
  completeReservation,
  releaseReservation,
  findOrCreateCustomer,
};
