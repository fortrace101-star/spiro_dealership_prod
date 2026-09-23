const express = require('express');
const { one, many } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/**
 * Build the WHERE window for a report query.
 * Supports either explicit ISO dates (?from=2026-01-01&to=2026-12-31)
 * or a day count (?days=30). Caps at 2 years, defaulting to 30 days.
 * Returns { clause, params } where clause uses $1/$2 placeholders.
 */
function reportWindow(req) {
  const MAX_DAYS = 730; // 2 years
  const params = [];
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  if (from && !Number.isNaN(from.getTime())) {
    const toSafe = to && !Number.isNaN(to.getTime()) ? to : new Date();
    const days = Math.max(1, Math.ceil((toSafe - from) / 86400000));
    if (days > MAX_DAYS) {
      return { error: 'Range too long: maximum is 2 years' };
    }
    params.push(from.toISOString());
    params.push(toSafe.toISOString());
    return { clause: `created_at >= $1 AND created_at < $2`, params };
  }

  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), MAX_DAYS);
  params.push(String(days));
  return { clause: `created_at >= now() - ($1 || ' days')::interval`, params };
}

/** Today's performance across all metrics — the dashboard's default view */
router.get('/today', async (req, res) => {
  // Product revenue/profit only — a credit sale never lands here, even after
  // approval; its money arrives later as settlements (second query below).
  // sales_count/discounts/cost stay all-completed: a finalized credit IS a sale.
  const sales = await one(
    `SELECT count(*)::int AS sales_count,
            COALESCE(sum(total) FILTER (WHERE payment_method <> 'credit'),0) AS revenue,
            COALESCE(sum(profit) FILTER (WHERE payment_method <> 'credit'),0) AS profit,
            COALESCE(sum(cost_total),0) AS cost,
            COALESCE(avg(total) FILTER (WHERE payment_method <> 'credit'),0) AS avg_transaction,
            COALESCE(sum(discount),0) AS discounts
       FROM sales
      WHERE created_at >= date_trunc('day', now()) AND status = 'completed'`
  );
  const settlement = await one(
    `SELECT COALESCE(sum(cp.amount),0) AS revenue,
            COALESCE(count(*),0)::int AS n,
            COALESCE(sum(cp.amount * (s.profit / NULLIF(s.total,0))),0) AS profit
       FROM credit_payments cp JOIN sales s ON s.id = cp.sale_id
      WHERE cp.created_at >= date_trunc('day', now())`
  );

  const payments = await many(
    `SELECT payment_method, COALESCE(sum(total),0) AS amount, count(*)::int AS n
       FROM sales
      WHERE created_at >= date_trunc('day', now()) AND status = 'completed'
        AND payment_method <> 'credit'
      GROUP BY payment_method ORDER BY amount DESC`
  );
  // Credit settlements are their own line — money received for debts, never
  // folded into cash/card (the sale itself was never revenue).
  if (Number(settlement.n) > 0) {
    payments.push({ payment_method: 'credit_settlement', amount: Number(settlement.revenue), n: Number(settlement.n) });
  }

  const items = await many(
    `SELECT si.kind, COALESCE(sum(si.line_total),0) AS amount, COALESCE(sum(si.qty),0) AS qty
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= date_trunc('day', now()) AND s.status = 'completed'
      GROUP BY si.kind`
  );

  const lowStock = await one(
    `SELECT count(*)::int AS n FROM products WHERE active AND stock_qty <= reorder_level`
  );
  const pendingApprovals = await one(
    `SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'`
  );
  const pendingSync = await one(
    `SELECT count(*)::int AS n FROM sales WHERE status = 'pending'`
  );
  const creditOutstanding = await one(
    `SELECT COALESCE(sum(total),0) - COALESCE((SELECT sum(amount) FROM credit_payments),0) AS amount
       FROM sales WHERE payment_method = 'credit' AND status = 'completed'`
  );
  const creditPending = await one(
    `SELECT count(*)::int AS n FROM sales WHERE status = 'pending_credit'`
  );

  const bikesSold = await one(
    `SELECT count(*)::int AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.kind='bike' AND s.created_at >= date_trunc('day', now())`
  );

  res.json({
    today: {
      sales_count: Number(sales.sales_count),
      revenue: Number(sales.revenue) + Number(settlement.revenue),
      profit: Number(sales.profit) + Number(settlement.profit),
      avg_transaction: Number(sales.avg_transaction),
      discounts: Number(sales.discounts),
      bikes_sold: Number(bikesSold?.n || 0),
      low_stock_count: Number(lowStock?.n || 0),
      pending_approvals: Number(pendingApprovals?.n || 0),
      pending_sync: Number(pendingSync?.n || 0),
      credit_outstanding: Number(creditOutstanding?.amount || 0),
      credit_pending: Number(creditPending?.n || 0),
      settlement_revenue: Number(settlement.revenue),
      settlement_profit: Number(settlement.profit),
    },
    payments,
    items,
  });
});

/** Hourly revenue/profit for today's area chart — hours in Uganda time (EAT, UTC+3) */
router.get('/today/hourly', async (req, res) => {
  const rows = await many(
    `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Africa/Kampala')::int AS hour,
            COALESCE(sum(total),0) AS revenue, COALESCE(sum(profit),0) AS profit
       FROM sales
      WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala')
        AND payment_method <> 'credit'
      GROUP BY hour ORDER BY hour`
  );
  // Settlement payments recognized in the hour they arrive — a credit sale's
  // money enters the chart here, never through the sale row itself.
  const settlements = await many(
    `SELECT EXTRACT(HOUR FROM cp.created_at AT TIME ZONE 'Africa/Kampala')::int AS hour,
            COALESCE(sum(cp.amount),0) AS revenue,
            COALESCE(sum(cp.amount * (s.profit / NULLIF(s.total,0))),0) AS profit
       FROM credit_payments cp JOIN sales s ON s.id = cp.sale_id
      WHERE cp.created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala')
      GROUP BY hour ORDER BY hour`
  );
  const nowHour = (new Date().getUTCHours() + 3) % 24;
  const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
  const stByHour = new Map(settlements.map((r) => [Number(r.hour), r]));
  const series = [];
  for (let h = 0; h <= nowHour; h++) {
    const r = byHour.get(h);
    const st = stByHour.get(h);
    series.push({
      hour: h,
      revenue: Number(r?.revenue || 0) + Number(st?.revenue || 0),
      profit: Number(r?.profit || 0) + Number(st?.profit || 0),
    });
  }
  res.json({ series });
});

/** Range report (?days=30 or ?from=ISO&to=ISO) — KPIs + daily breakdown */
router.get('/range', async (req, res) => calendarQuery(req, res));

async function calendarQuery(req, res) {
  const win = reportWindow(req);
  if (win.error) return res.status(400).json({ error: win.error });
  const { clause, params } = win;

  const kpi = await one(
    `SELECT count(*)::int AS sales_count,
            COALESCE(sum(total) FILTER (WHERE payment_method <> 'credit'),0) AS revenue,
            COALESCE(sum(profit) FILTER (WHERE payment_method <> 'credit'),0) AS profit,
            COALESCE(avg(total) FILTER (WHERE payment_method <> 'credit'),0) AS avg_transaction
       FROM sales
      WHERE ${clause} AND status='completed'`, params
  );
  // Settlements received inside the window — the credit half of revenue.
  const settlement = await one(
    `SELECT COALESCE(sum(cp.amount),0) AS revenue,
            COALESCE(sum(cp.amount * (s.profit / NULLIF(s.total,0))),0) AS profit
       FROM credit_payments cp JOIN sales s ON s.id = cp.sale_id
      WHERE cp.${clause}`, params
  );
  const daily = await many(
    `SELECT date_trunc('day', created_at)::date AS day,
            COALESCE(sum(total) FILTER (WHERE payment_method <> 'credit'),0) AS revenue,
            COALESCE(sum(profit) FILTER (WHERE payment_method <> 'credit'),0) AS profit
       FROM sales
      WHERE ${clause} AND status='completed'
      GROUP BY day ORDER BY day`, params
  );
  const dailySettle = await many(
    `SELECT date_trunc('day', cp.created_at)::date AS day,
            COALESCE(sum(cp.amount),0) AS revenue,
            COALESCE(sum(cp.amount * (s.profit / NULLIF(s.total,0))),0) AS profit
       FROM credit_payments cp JOIN sales s ON s.id = cp.sale_id
      WHERE cp.${clause}
      GROUP BY day ORDER BY day`, params
  );
  // Each day = product revenue + settlements received that day; `settlement`
  // kept alongside so the UI can show the split.
  const settleByDay = new Map(dailySettle.map((r) => [String(r.day), r]));
  for (const row of daily) {
    const st = settleByDay.get(String(row.day));
    const add = Number(st?.revenue || 0);
    row.revenue = Number(row.revenue) + add;
    row.profit = Number(row.profit) + Number(st?.profit || 0);
    row.settlement = add;
  }
  const bikesSold = await one(
    `SELECT count(*)::int AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.kind='bike' AND s.${clause}`, params
  );
  const partsSold = await one(
    `SELECT COALESCE(sum(si.qty),0)::int AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.kind='part' AND s.${clause}`, params
  );
  // Outstanding debt is a point-in-time balance: all finalized credit sales
  // minus every settlement received (never windowed — it exists today).
  const credit = await one(
    `SELECT COALESCE(sum(total),0) - COALESCE((SELECT sum(amount) FROM credit_payments),0) AS amount
       FROM sales WHERE payment_method='credit' AND status='completed'`
  );
  const creditPending = await one(
    `SELECT count(*)::int AS n FROM sales WHERE status='pending_credit'`
  );
  const stockValue = await one(
    `SELECT COALESCE(sum(stock_qty * cost_price),0) AS amount FROM products WHERE active`
  );

  res.json({
    kpi: {
      sales_count: Number(kpi.sales_count),
      revenue: Number(kpi.revenue),
      profit: Number(kpi.profit),
      avg_transaction: Number(kpi.avg_transaction),
      bikes_sold: Number(bikesSold?.n || 0),
      parts_sold: Number(partsSold?.n || 0),
      credit_outstanding: Number(credit?.amount || 0),
      stock_value: Number(stockValue?.amount || 0),
    },
    daily,
  });
}

/** Top products by revenue/profit/qty over a range */
router.get('/top-products', async (req, res) => {
  const win = reportWindow(req);
  if (win.error) return res.status(400).json({ error: win.error });
  const { clause, params } = win;
  const order = ['revenue', 'profit', 'qty'].includes(req.query.order) ? req.query.order : 'revenue';
  const col = { revenue: 'revenue', profit: 'profit', qty: 'qty' }[order];
  const products = await many(
    `SELECT si.name,
            sum(si.qty)::int AS qty,
            COALESCE(sum(si.line_total),0) AS revenue,
            COALESCE(sum(si.line_total - (si.unit_cost * si.qty)),0) AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.${clause}
      GROUP BY si.name
      ORDER BY ${col} DESC
      LIMIT 20`, params
  );
  res.json({ products });
});

/** Payment mix over a range */
router.get('/payments', async (req, res) => {
  const win = reportWindow(req);
  if (win.error) return res.status(400).json({ error: win.error });
  const { clause, params } = win;
  const payments = await many(
    `SELECT payment_method, COALESCE(sum(total),0) AS amount
       FROM sales
      WHERE ${clause} AND status='completed'
      GROUP BY payment_method ORDER BY amount DESC`, params
  );
  res.json({ payments });
});

/** Cashier leaderboard over a range */
router.get('/cashiers', async (req, res) => {
  const win = reportWindow(req);
  if (win.error) return res.status(400).json({ error: win.error });
  const { clause, params } = win;
  const rows = await many(
    `SELECT u.id, u.full_name, count(s.id)::int AS sales_count,
            COALESCE(sum(s.total),0) AS revenue, COALESCE(sum(s.profit),0) AS profit,
            COALESCE(sum(s.discount),0) AS discounts
       FROM users u LEFT JOIN sales s ON s.cashier_id = u.id
         AND s.${clause}
      WHERE u.role IN ('cashier','manager')
      GROUP BY u.id ORDER BY revenue DESC`, params
  );
  res.json({ cashiers: rows });
});

/** Low-stock / reorder alerts */
router.get('/low-stock', async (req, res) => {
  const products = await many(
    `SELECT id, sku, name, stock_qty, min_stock, reorder_level
       FROM products
      WHERE active AND stock_qty <= reorder_level
      ORDER BY (stock_qty::float / GREATEST(reorder_level,1)) ASC LIMIT 50`
  );
  res.json({ products });
});

module.exports = router;
