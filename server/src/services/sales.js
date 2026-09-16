const { pool, one } = require('../db');

/**
 * Record a sale idempotently (client_txn_id unique), insert items, deduct stock,
 * write stock movements, link customer/bike, and trigger admin push notifications.
 * Runs in a single transaction; returns { sale, items, duplicate }.
 */
async function recordSale(input, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---- Idempotency: same client_txn_id returns the existing sale ----
    const existing = await client.query(`SELECT * FROM sales WHERE client_txn_id = $1`, [input.client_txn_id]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      const sale = existing.rows[0];
      const items = await client.query(`SELECT * FROM sale_items WHERE sale_id = $1`, [sale.id]);
      return { sale, items: items.rows, duplicate: true };
    }

    // ---- Receipt number: SR-YYYYMMDD-#### per day ----
    const day = new Date(input.created_at || Date.now());
    const stamp = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM sales WHERE receipt_no LIKE $1`, [`SR-${stamp}-%`]
    );
    const receiptNo = input.receipt_no || `SR-${stamp}-${String(countRes.rows[0].n + 1).padStart(4, '0')}`;

    // ---- Customer (create/attach by phone when provided) ----
    let customerId = input.customer_id || null;
    if (!customerId && input.customer && input.customer.phone) {
      const found = await client.query(`SELECT id FROM customers WHERE phone = $1`, [input.customer.phone]);
      if (found.rows[0]) {
        customerId = found.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO customers (full_name, phone) VALUES ($1,$2) RETURNING id`,
          [input.customer.name || 'Walk-in', input.customer.phone]
        );
        customerId = created.rows[0].id;
      }
    }

    // ---- Derive bike link when the client only set it on items ----
    const bikeId = input.bike_id || (input.items || []).find((it) => it.kind === 'bike' && it.bike_id)?.bike_id || null;

    // ---- Totals ----
    const subtotal = Number(input.subtotal || 0);
    const discount = Number(input.discount || 0);
    const total = Number(input.total || 0);
    const costTotal = Number(input.cost_total || 0);

    // ---- Insert sale ----
    const saleRes = await client.query(
      `INSERT INTO sales
         (client_txn_id, receipt_no, cashier_id, customer_id, bike_id,
          subtotal, discount, total, cost_total, profit,
          payment_method, amount_paid, change_due, device_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16, now()))
       RETURNING *`,
      [
        input.client_txn_id, receiptNo, actor.id, customerId, bikeId,
        subtotal, discount, total, costTotal, total - costTotal,
        input.payment_method, Number(input.amount_paid || 0), Number(input.change_due || 0),
        input.device_id || null, input.payment_method === 'credit' ? 'completed' : 'completed',
        input.created_at || null,
      ]
    );
    const sale = saleRes.rows[0];

    // ---- Items + stock deduction as movements ----
    const items = [];
    for (const it of input.items || []) {
      const itemRes = await client.query(
        `INSERT INTO sale_items
           (sale_id, product_id, bike_id, name, kind, qty, unit_price, unit_cost, discount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          sale.id, it.product_id || null, it.bike_id || null, it.name, it.kind || 'part',
          it.qty, it.unit_price, it.unit_cost || 0, it.discount || 0, it.line_total,
        ]
      );
      items.push(itemRes.rows[0]);

      if (it.kind === 'bike' && it.bike_id) {
        // Bike leaves inventory: mark sold, assign customer
        await client.query(
          `UPDATE bikes
              SET status = 'sold', sold_at = COALESCE($2, now()), sold_price = $3, customer_id = COALESCE($4, customer_id), updated_at = now()
            WHERE id = $1 AND status <> 'sold'`,
          [it.bike_id, input.created_at || null, it.unit_price, customerId]
        );
      } else if (it.product_id) {
        await client.query(`UPDATE products SET stock_qty = stock_qty - $2, updated_at = now() WHERE id = $1`, [it.product_id, it.qty]);
        await client.query(
          `INSERT INTO stock_movements (product_id, qty, type, sale_id, user_id, device_id, client_txn_id, note)
           VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7)`,
          [it.product_id, -Math.abs(it.qty), sale.id, actor.id, input.device_id || null, input.client_txn_id, `Sale ${receiptNo}`]
        );
      }
    }

    // ---- Credit sale creates a manager approval request ----
    if (input.payment_method === 'credit') {
      await client.query(
        `INSERT INTO approvals (type, requested_by, payload, status)
         VALUES ('credit_sale', $1, $2, 'pending')`,
        [actor.id, JSON.stringify({ sale_id: sale.id, receipt_no: receiptNo, total, customer_id: customerId })]
      );
    }

    // ---- Discount beyond 5% also requires approval (Phase 1 control) ----
    if (subtotal > 0 && discount / subtotal > 0.05) {
      await client.query(
        `INSERT INTO approvals (type, requested_by, payload, status)
         VALUES ('discount', $1, $2, 'pending')`,
        [actor.id, JSON.stringify({ sale_id: sale.id, receipt_no: receiptNo, subtotal, discount, pct: +(discount / subtotal * 100).toFixed(1) })]
      );
    }

    await client.query('COMMIT');

    // ---- Push notifications AFTER commit (DB update happened) ----
    const cashierName = actor.full_name || 'Cashier';
    const pushSvc = require('./push');
    setImmediate(() => {
      pushSvc.notifyAdmins(pushSvc.saleNotification({ ...sale, cashier_name: cashierName })).catch(() => {});
    });

    return { sale, items, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { recordSale };
