/**
 * Credit sales — approval → liability → settlement.
 *
 * Accounting rule (why this module exists):
 *  - Checkout saves the sale as 'pending_credit': no stock, no revenue, no debt.
 *  - Admin approval only ARMS it — stock deducts when the POS operator clicks
 *    Finalize (finalizeSale), which is the moment the sale registers and the
 *    debt opens. Rejection parks the sale as 'rejected' with zero consequence:
 *    nothing ever moved.
 *  - The debt is never revenue. Each payment (recordPayment) is recognized as
 *    revenue + proportional profit on the day it is received.
 * Partial-settlement math mirrors bike_installment_payments / reservations.
 */
const { pool, one, many } = require('../db');
const { audit } = require('../middleware/audit');
const pushSvc = require('./push');
const { checkRevenueRecords } = require('./sales');

const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank', 'card'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Decide a credit_sale approval in one transaction: the approval row and the
 * sale's 'pending_credit' → 'rejected' flip can never diverge. On approve the
 * sale deliberately stays 'pending_credit' — only the POS operator's Finalize
 * click opens stock/debt. The sale's cashier is pushed the outcome either way.
 */
async function decideCreditApproval(approvalId, decision, note, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prior = (await client.query(
      `SELECT * FROM approvals WHERE id = $1 AND type = 'credit_sale' FOR UPDATE`,
      [approvalId]
    )).rows[0];
    if (!prior) throw httpError(404, 'Credit approval not found');

    const upd = (await client.query(
      `UPDATE approvals SET status = $2, decided_by = $3, decided_at = now(), note = $4
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [approvalId, decision, actor.id, note || null]
    )).rows[0];
    if (!upd) throw httpError(400, 'Approval not found or already decided');

    const saleId = (prior.payload || {}).sale_id || null;
    let sale = null;
    if (saleId) {
      if (decision === 'rejected') {
        const s = (await client.query(
          `UPDATE sales SET status = 'rejected' WHERE id = $1 AND status = 'pending_credit' RETURNING *`,
          [saleId]
        )).rows[0];
        // Already-finalized (or missing) sales stay untouched — rejection must
        // never restock or reverse anything, because nothing ever moved.
        sale = s || (await client.query(`SELECT * FROM sales WHERE id = $1`, [saleId])).rows[0];
      } else {
        sale = (await client.query(`SELECT * FROM sales WHERE id = $1`, [saleId])).rows[0];
      }
    }
    await client.query('COMMIT');

    await audit({ userId: actor.id, action: `approval_${decision}`, entity: 'approval', entityId: approvalId, newValue: upd });
    if (decision === 'rejected' && sale) {
      await audit({ userId: actor.id, action: 'credit_rejected', entity: 'sales', entityId: sale.id, newValue: { status: sale.status } });
    }
    if (sale && sale.cashier_id) pushSvc.notifyUser(sale.cashier_id, pushSvc.creditDecision(decision, sale)).catch(() => {});
    return { approval: upd, sale };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Finalize an approved credit sale — the POS operator's explicit completion
 * click. Stock deducts here (never at checkout), the sale registers as
 * completed and the debt opens. Idempotent: a second call (offline retry)
 * returns { duplicate: true } without touching stock.
 * Guard: if approval is missing/rejected, or stock ran out while awaiting
 * approval, throws 409 — never drives stock negative; the admin decides
 * (reject = zero consequence).
 */
async function finalizeSale(saleId, actor, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sale = (await client.query(`SELECT * FROM sales WHERE id = $1 FOR UPDATE`, [saleId])).rows[0];
    if (!sale) throw httpError(404, 'Sale not found');
    if (sale.payment_method !== 'credit') throw httpError(409, 'Not a credit sale');
    if (sale.status === 'completed') {
      await client.query('COMMIT');
      return { duplicate: true, sale };
    }
    if (sale.status === 'rejected') throw httpError(409, 'Credit sale was rejected — nothing to finalize');
    if (sale.status !== 'pending_credit') throw httpError(409, `Sale is not awaiting finalization (status: ${sale.status})`);

    const approval = (await client.query(
      `SELECT status FROM approvals WHERE type = 'credit_sale' AND payload ->> 'sale_id' = $1
        ORDER BY created_at DESC LIMIT 1`, [saleId]
    )).rows[0];
    if (!approval) throw httpError(409, 'No credit approval found for this sale');
    if (approval.status !== 'approved') throw httpError(409, 'Credit sale not yet approved by a manager');

    const items = (await client.query(`SELECT * FROM sale_items WHERE sale_id = $1`, [saleId])).rows;

    // Guard: stock may have sold out while awaiting approval — block instead of
    // driving stock negative; the admin rejects or instructs from there.
    for (const it of items) {
      if (it.kind === 'bike' && it.bike_id) {
        const b = (await client.query(`SELECT status FROM bikes WHERE id = $1 FOR UPDATE`, [it.bike_id])).rows[0];
        if (!b || b.status === 'sold') throw httpError(409, `"${it.name}" is no longer available (sold while awaiting approval)`);
      } else if (it.product_id) {
        const p = (await client.query(`SELECT stock_qty FROM products WHERE id = $1 FOR UPDATE`, [it.product_id])).rows[0];
        if (!p || Number(p.stock_qty) < Number(it.qty)) {
          throw httpError(409, `"${it.name}" has only ${p ? p.stock_qty : 0} in stock (needs ${it.qty}) — awaiting admin decision`);
        }
      }
    }

    // Stock deduction — mirrors recordSale's completed-sale path exactly.
    const finTxn = opts.client_txn_id || `${sale.client_txn_id}:fin`;
    for (const it of items) {
      if (it.kind === 'bike' && it.bike_id) {
        await client.query(
          `UPDATE bikes SET status='sold', sold_at=now(), sold_price=$2,
                  customer_id=COALESCE($3, customer_id), updated_at=now()
            WHERE id=$1 AND status <> 'sold'`,
          [it.bike_id, it.unit_price, sale.customer_id]
        );
      } else if (it.product_id) {
        await client.query(`UPDATE products SET stock_qty = stock_qty - $2, updated_at=now() WHERE id = $1`, [it.product_id, it.qty]);
        await client.query(
          `INSERT INTO stock_movements (product_id, qty, type, sale_id, user_id, device_id, client_txn_id, note)
           VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7)`,
          [it.product_id, -Math.abs(it.qty), sale.id, actor.id, opts.device_id || sale.device_id || null,
           finTxn, `Sale ${sale.receipt_no} (credit finalized)`]
        );
      }
    }

    const upd = (await client.query(
      `UPDATE sales SET status = 'completed', synced_at = now() WHERE id = $1 AND status = 'pending_credit' RETURNING *`,
      [saleId]
    )).rows[0];
    await client.query('COMMIT');
    if (!upd) return { duplicate: true, sale };

    await audit({ userId: actor.id, action: 'credit_finalized', entity: 'sales', entityId: sale.id, newValue: { status: 'completed', total: sale.total } });
    return { duplicate: false, sale: upd };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Record a settlement payment against a finalized credit sale. The money is
 * recognized as revenue + proportional profit on the day it lands (the debt
 * itself was never revenue). Partial payments allowed; balance is always
 * derived. Idempotent on client_txn_id — the POS queues payments offline.
 */
async function recordPayment(input, actor) {
  const amt = Number(input.amount);
  if (!Number.isFinite(amt) || amt <= 0) throw httpError(400, 'Payment amount must be greater than zero');
  if (!PAYMENT_METHODS.includes(input.payment_method)) {
    throw httpError(400, `payment_method must be one of ${PAYMENT_METHODS.join(', ')}`);
  }
  if (!input.client_txn_id) throw httpError(400, 'client_txn_id required (idempotency key)');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sale = (await client.query(`SELECT * FROM sales WHERE id = $1 FOR UPDATE`, [input.saleId])).rows[0];
    if (!sale) throw httpError(404, 'Sale not found');
    if (sale.payment_method !== 'credit') throw httpError(409, 'Not a credit sale');
    if (sale.status !== 'completed') {
      throw httpError(409, sale.status === 'pending_credit'
        ? 'Credit sale not yet finalized — approval and operator finalization must complete first'
        : `Credit sale is ${sale.status} — no debt exists`);
    }

    const paidOf = async () => Number((await client.query(
      `SELECT COALESCE(sum(amount),0) AS paid FROM credit_payments WHERE sale_id = $1`, [sale.id]
    )).rows[0].paid);

    // Offline retry: same key = same receipt, never a second payment.
    const dup = (await client.query(`SELECT * FROM credit_payments WHERE client_txn_id = $1`, [input.client_txn_id])).rows[0];
    if (dup) {
      const paid = await paidOf();
      await client.query('COMMIT');
      const balance = Number(sale.total) - paid;
      return { duplicate: true, payment: dup, paid, balance, status: balance <= 0.009 ? 'settled' : 'outstanding' };
    }

    const paidBefore = await paidOf();
    const balanceBefore = Number(sale.total) - paidBefore;
    if (amt > balanceBefore + 0.009) {
      throw httpError(400, `Payment exceeds the outstanding balance (balance: UGX ${Math.round(balanceBefore).toLocaleString('en-UG')})`);
    }

    const pay = (await client.query(
      `INSERT INTO credit_payments (sale_id, amount, payment_method, paid_by, device_id, client_txn_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sale.id, amt, input.payment_method, actor.id, input.device_id || null, input.client_txn_id, input.note || null]
    )).rows[0];
    await client.query('COMMIT');

    const paid = paidBefore + amt;
    const balance = Number(sale.total) - paid;
    const status = balance <= 0.009 ? 'settled' : 'outstanding';
    await audit({ userId: actor.id, action: 'credit_payment_received', entity: 'sales', entityId: sale.id,
      newValue: { amount: amt, paid, balance, status } });
    // Settlement revenue may set a new all-time-high day/week/month.
    checkRevenueRecords(pushSvc).catch(() => {});
    return { duplicate: false, payment: pay, paid, balance, status };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin ledger views: pending (awaiting decision), outstanding (debt not yet
 * paid), settled (fully paid). Every row carries paid/balance, the customer,
 * the cashier, the full payment history AND the product/bike line items so the
 * drawer can show exactly what was taken on credit (query + verification).
 *
 * Search: q matches customer name, phone or receipt; from/to filter the sale
 * date (inclusive on both ends) — used by the dashboard's search controls.
 */
async function listCreditLedger(view, filters = {}) {
  const v = ['pending', 'outstanding', 'settled'].includes(view) ? view : 'outstanding';
  const where = {
    pending: `s.status = 'pending_credit'`,
    outstanding: `s.status = 'completed' AND s.total > COALESCE(p.paid, 0) + 0.009`,
    settled: `s.status = 'completed' AND s.total <= COALESCE(p.paid, 0) + 0.009`,
  }[v];

  const params = [];
  const clauses = [];
  const q = typeof filters.q === 'string' ? filters.q.trim() : '';
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    clauses.push(
      `(c.full_name ILIKE $${n} OR c.phone ILIKE $${n} OR s.receipt_no ILIKE $${n})`
    );
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`s.created_at >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    // + 1 day, < : keeps 23:59:59.9 of the picked "to" day inside the range.
    clauses.push(`s.created_at < ($${params.length}::date + interval '1 day')`);
  }
  const extraWhere = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';

  return many(
    `SELECT s.id, s.receipt_no, s.total, s.created_at, s.status,
            c.full_name AS customer_name, c.phone AS customer_phone,
            u.full_name AS cashier_name,
            COALESCE(p.paid, 0) AS paid,
            s.total - COALESCE(p.paid, 0) AS balance,
            (SELECT a.status FROM approvals a
              WHERE a.type = 'credit_sale' AND a.payload ->> 'sale_id' = s.id::text
              ORDER BY a.created_at DESC LIMIT 1) AS approval_status,
            COALESCE((SELECT json_agg(json_build_object(
                       'id', cp.id, 'amount', cp.amount, 'payment_method', cp.payment_method,
                       'note', cp.note, 'created_at', cp.created_at) ORDER BY cp.created_at DESC)
                      FROM credit_payments cp WHERE cp.sale_id = s.id), '[]'::json) AS payments,
            COALESCE((SELECT json_agg(json_build_object(
                       'id', si.id, 'name', si.name, 'kind', si.kind, 'qty', si.qty,
                       'unit_price', si.unit_price, 'line_total', si.line_total)
                       ORDER BY si.id)
                      FROM sale_items si WHERE si.sale_id = s.id), '[]'::json) AS items
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.cashier_id
       LEFT JOIN LATERAL (SELECT sum(cp.amount) AS paid FROM credit_payments cp WHERE cp.sale_id = s.id) p ON true
      WHERE s.payment_method = 'credit' AND ${where}${extraWhere}
      ORDER BY s.created_at DESC
      LIMIT 100`,
    params
  );
}

/**
 * POS confirms reception of a rejection — the desk keeps showing the rejected
 * sale until this lands (the mirror image of Finalize for approvals, which is
 * what makes rejections persist "just like approved ones"). Idempotent:
 * COALESCE never overwrites an existing confirmation, so retries are free.
 */
async function acknowledgeRejection(saleId, actor) {
  const sale = await one(`SELECT id, status FROM sales WHERE id = $1`, [saleId]);
  if (!sale) throw httpError(404, 'Sale not found');
  if (sale.status !== 'rejected') throw httpError(409, 'Only rejected credit sales need confirmation');
  const rec = await one(
    `UPDATE approvals SET acknowledged_at = COALESCE(acknowledged_at, now())
      WHERE type = 'credit_sale' AND status = 'rejected' AND payload ->> 'sale_id' = $1
      RETURNING acknowledged_at`,
    [saleId]
  );
  if (!rec) throw httpError(404, 'No rejection recorded for this sale');
  await audit({ userId: actor.id, action: 'credit_rejection_confirmed', entity: 'sales', entityId: saleId, newValue: { status: 'rejected' } });
  return { ok: true, sale_id: saleId, acknowledged_at: rec.acknowledged_at };
}

module.exports = { decideCreditApproval, finalizeSale, recordPayment, listCreditLedger, acknowledgeRejection };
