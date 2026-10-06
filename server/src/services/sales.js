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
      console.log(`[sale] DUPLICATE ignored: ${sale.receipt_no || sale.client_txn_id} total=${Number(sale.total).toLocaleString('en-UG')} — already recorded, no changes made`);
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

    // ---- Item references come from a catalog snapshot the client may have taken
    // before the server data changed (data reset, deleted product, part created
    // offline). A completed sale must still be recorded, so references the server
    // does not know are stored as NULL instead of failing the foreign key forever.
    const itemList = Array.isArray(input.items) ? input.items : [];
    const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
    const productIds = [...new Set(itemList.map((it) => it.product_id).filter(isUuid))];
    const bikeIds = [...new Set(itemList.map((it) => it.bike_id).filter(isUuid).concat(isUuid(input.bike_id) ? [input.bike_id] : []))];
    const knownProducts = productIds.length
      ? new Set((await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[])`, [productIds])).rows.map((r) => r.id))
      : new Set();
    const knownBikes = bikeIds.length
      ? new Set((await client.query(`SELECT id FROM bikes WHERE id = ANY($1::uuid[])`, [bikeIds])).rows.map((r) => r.id))
      : new Set();
    const knownProduct = (id) => (isUuid(id) && knownProducts.has(id) ? id : null);
    const knownBike = (id) => (isUuid(id) && knownBikes.has(id) ? id : null);

    // ---- Derive bike link when the client only set it on items ----
    const bikeId = knownBike(input.bike_id || itemList.find((it) => it.kind === 'bike' && it.bike_id)?.bike_id || null);

    // Traceability guard: E-Bike sales should always carry a customer. The POS
    // enforces this at checkout; here we only warn (instead of rejecting) so a
    // sale queued offline before the client update can still sync instead of
    // being stuck in a permanent failure loop.
    if ((bikeId || itemList.some((it) => it.kind === 'bike')) && !customerId) {
      console.warn(`[sale] bike sale ${input.client_txn_id} has no customer linked — POS checkout now requires name + phone for E-Bike sales`);
    }

    // ---- Totals ----
    const subtotal = Number(input.subtotal || 0);
    const discount = Number(input.discount || 0);
    // Sum of per-line discounts (used by the discount approval ticket below).
    // Must live here in the service: routes/pos.js computes its own copy for the
    // admin-only 403 gate, but /sync/push calls recordSale directly, so queued
    // offline sales reach this scope without ever passing through the route.
    const lineDiscount = itemList.reduce((sum, it) => sum + Number(it.discount || 0), 0);
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
        input.device_id || null, input.payment_method === 'credit' ? 'pending_credit' : 'completed',
        input.created_at || null,
      ]
    );
    const sale = saleRes.rows[0];

    // ---- Items + stock deduction as movements ----
    const items = [];
    for (const it of itemList) {
      const productRef = knownProduct(it.product_id);
      const bikeRef = knownBike(it.bike_id);
      if ((it.product_id && !productRef) || (it.bike_id && !bikeRef)) {
        console.warn(`[sale] ${receiptNo}: "${it.name}" references an item the server does not have — recorded without a stock link`);
      }
      const itemRes = await client.query(
        `INSERT INTO sale_items
           (sale_id, product_id, bike_id, name, kind, qty, unit_price, unit_cost, discount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          sale.id, productRef, bikeRef, it.name, it.kind || 'part',
          it.qty, it.unit_price, it.unit_cost || 0, it.discount || 0, it.line_total,
        ]
      );
      items.push(itemRes.rows[0]);

      // Credit sales hold NOTHING until the POS operator finalizes after admin
      // approval — stock, bike status and movements all happen in
      // services/credit.finalizeSale instead. Items are still inserted above so
      // the receipt renders and finalize knows what to deduct.
      if (sale.status !== 'pending_credit') {
        if (it.kind === 'bike' && bikeRef) {
          // Bike leaves inventory: mark sold, assign customer
          await client.query(
            `UPDATE bikes
                SET status = 'sold', sold_at = COALESCE($2, now()), sold_price = $3, customer_id = COALESCE($4, customer_id), updated_at = now()
              WHERE id = $1 AND status <> 'sold'`,
            [bikeRef, input.created_at || null, it.unit_price, customerId]
          );
        } else if (productRef) {
          await client.query(`UPDATE products SET stock_qty = stock_qty - $2, updated_at = now() WHERE id = $1`, [productRef, it.qty]);
          await client.query(
            `INSERT INTO stock_movements (product_id, qty, type, sale_id, user_id, device_id, client_txn_id, note)
             VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7)`,
            [productRef, -Math.abs(it.qty), sale.id, actor.id, input.device_id || null, input.client_txn_id, `Sale ${receiptNo}`]
          );
        }
      }
    }

    // ---- Credit sale creates a manager approval request ----
    // Approval requests are pushed to admins after commit (see setImmediate below).
    const approvalPushes = [];
    if (input.payment_method === 'credit') {
      await client.query(
        `INSERT INTO approvals (type, requested_by, payload, status)
         VALUES ('credit_sale', $1, $2, 'pending')`,
        [actor.id, JSON.stringify({ sale_id: sale.id, receipt_no: receiptNo, total, customer_id: customerId })]
      );
      approvalPushes.push({
        title: '🧾 Credit sale approval',
        body: `Receipt ${receiptNo} — UGX ${Number(total || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })} on credit needs manager approval`,
        url: '/approvals',
        tag: 'approval:' + sale.id + ':credit',
        saleId: sale.id,
        receiptNo,
        total,
      });
    }

    // ---- Discounts: admin-only, always. Every discount (any amount, header or
    // line level) needs admin approval exactly like a credit sale — the POS
    // checkout has no discount field and only an admin can issue one, so any
    // payload carrying a discount opens an approval ticket instead of moving
    // money. Cashier/manager sales always arrive with discount 0.
    const discountApprovalNeeded = discount > 0 || lineDiscount > 0;
    if (discountApprovalNeeded) {
      await client.query(
        `INSERT INTO approvals (type, requested_by, payload, status)
         VALUES ('discount', $1, $2, 'pending')`,
        [actor.id, JSON.stringify({ sale_id: sale.id, receipt_no: receiptNo, subtotal, discount: discount + lineDiscount, pct: subtotal > 0 ? +((discount + lineDiscount) / subtotal * 100).toFixed(1) : 0 })]
      );
      approvalPushes.push({
        title: '💰 Discount approval',
        body: `Receipt ${receiptNo} — UGX ${Number(discount + lineDiscount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })} discount needs admin approval`,
        url: '/approvals',
        tag: 'approval:' + sale.id + ':discount',
        saleId: sale.id,
        receiptNo,
        subtotal,
        discount: discount + lineDiscount,
      });
    }

    await client.query('COMMIT');

    // ---- Console log + push notifications AFTER commit (DB updated) ----
    const cashierName = actor.full_name || 'Cashier';
    console.log(
      `[sale] RECORDED ${sale.receipt_no} | ${cashierName} | UGX ${Number(sale.total).toLocaleString('en-UG', { maximumFractionDigits: 0 })} | ${sale.payment_method}${input.device_id ? ` | device ${input.device_id}` : ''}${(input.items || []).length ? ` | ${input.items.length} item(s)` : ''}`
    );
    const pushSvc = require('./push');
    const { emit } = require('../routes/events');
    // Live cross-stack signal (Workstream D): the admin console recounts its
    // cards/badges the instant a sale lands, without waiting for its poll.
    if (sale.status === 'pending_credit') {
      emit('approval.created', { saleId: sale.id, receiptNo: sale.receipt_no, total: Number(sale.total) || 0 });
    } else {
      emit('sale.created', {
        saleId: sale.id,
        receiptNo: sale.receipt_no,
        total: Number(sale.total) || 0,
        paymentMethod: sale.payment_method,
      });
      emit('stock.changed', { reason: 'sale', saleId: sale.id, receiptNo: sale.receipt_no });
    }
    setImmediate(async () => {
      // A pending credit sale is announced only through its approval push —
      // it has no stock, no revenue and no liability until finalized.
      if (sale.status !== 'pending_credit') {
        pushSvc.notifyAdmins(pushSvc.saleNotification({ ...sale, cashier_name: cashierName })).catch(() => {})
        // POS terminals: two-line toast (sale total + running day revenue).
        // Mirrors the /today report window (completed, non-credit, server-day)
        // and includes this sale — it is already COMMITTED above. Non-blocking:
        // a notification failure never affects the sale.
        one(`SELECT COALESCE(sum(total),0) AS r FROM sales
             WHERE status = 'completed' AND payment_method <> 'credit'
               AND created_at >= date_trunc('day', now())`)
          .then((row) => pushSvc.posSale(sale, Number(row && row.r) || 0))
          .catch(() => {})
      }
      // Pending approval requests created by this sale (credit / big discount)
      for (const p of approvalPushes) pushSvc.notifyAdmins(p).catch(() => {})
      // Low-stock / stock-out warnings after stock deduction
      // (fresh pool queries — this runs after COMMIT/client release).
      if (sale.status !== 'pending_credit') {
        try {
          for (const it of input.items || []) {
            if (it.product_id && typeof it.product_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(it.product_id)) {
              const p = await one(
                `SELECT id, name, sku, stock_qty, reorder_level FROM products WHERE id = $1`,
                [it.product_id]
              )
              if (p) {
                const qty = Number(p.stock_qty)
                const warn = pushSvc.stockWarning(p, qty, it.kind === 'bike' ? `Bike sold — ${receiptNo}` : `Sale ${receiptNo}`)
                if (warn) pushSvc.notifyAdmins(warn).catch(() => {})
              }
            }
          }
        } catch {}
      }
      // Daily revenue line for the admin inbox (see helper). Pending-credit
      // requests move no money, so they must not publish an unchanged figure.
      if (sale.status !== 'pending_credit') checkRevenueRecords(pushSvc).catch(() => {})
    });

    return { sale, items, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Publish today's cumulative revenue to the admin inbox on EVERY transaction
 * (completed, non-credit sales — the same window as /reports/today revenue
 * and the POS toast message2), and silently refresh the week/month
 * all-time-high rows in revenue_records.
 * Uses fresh pool queries, so it is safe to call from setImmediate after COMMIT.
 */
async function checkRevenueRecords(pushSvc) {
  // $trunc is one of our own literals ('week'|'month') — never user input.
  const periodTotal = async (trunc) => one(
    `SELECT COALESCE((SELECT sum(total) FROM sales
        WHERE status='completed' AND payment_method <> 'credit'
          AND date_trunc('${trunc}', created_at) = date_trunc('${trunc}', CURRENT_DATE)), 0)
        + COALESCE((SELECT sum(amount) FROM credit_payments
          WHERE date_trunc('${trunc}', created_at) = date_trunc('${trunc}', CURRENT_DATE)), 0) AS t`
  );

  // Silent bookkeeping: keep the week/month all-time-high rows fresh. The
  // admin-facing notification is the per-transaction daily figure below.
  // NOTE: `id` defaults to 1 (legacy single-row table), so a blind INSERT for a
  // period that has no row yet collides with the seeded row's PRIMARY KEY. That
  // error used to kill this whole helper silently — including the revenue
  // notification below, which is why no 'revenue' inbox row ever appeared.
  // Update-or-insert explicitly instead: row exists → UPDATE when beaten;
  // otherwise INSERT with a fresh id.
  const bump = async (period, total) => {
    const cur = Number(total || 0)
    const row = await one(`SELECT id, revenue FROM revenue_records WHERE period = $1`, [period])
    if (row) {
      if (cur > Number(row.revenue || 0)) {
        await one(`UPDATE revenue_records SET revenue = $2, date = CURRENT_DATE WHERE id = $1`, [row.id, cur])
      }
      return
    }
    await one(
      `INSERT INTO revenue_records (id, period, revenue, date)
       SELECT COALESCE(MAX(id), 0) + 1, $1, $2, CURRENT_DATE FROM revenue_records
       RETURNING id`,
      [period, cur]
    )
  }

  try {
    await bump('week', (await periodTotal('week')).t)
    await bump('month', (await periodTotal('month')).t)
    // Every transaction republishes the running day total. CURRENT_DATE labels
    // the same day boundary the date_trunc window uses.
    if (pushSvc) {
      const day = await one(
        `SELECT COALESCE(sum(total),0) AS r, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d
           FROM sales
          WHERE status = 'completed' AND payment_method <> 'credit'
            AND created_at >= date_trunc('day', now())`
      )
      const revenue = pushSvc.revenueRecord(Number(day?.r || 0), day?.d);
      pushSvc.notifyAdmins(revenue).catch(() => {})
      // The POS sees the same running-total notification in its bell (and as
      // an OS push) — same payload, POS-floor audience.
      pushSvc.notifyPosFloor(revenue).catch(() => {})
    }
  } catch {}
}

module.exports = { recordSale, checkRevenueRecords };
