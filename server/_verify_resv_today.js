/** Temp live-DB check for the new /today reservation aggregates (deleted after run). */
const { pool } = require('./src/db/index.js');

(async () => {
  const a = await pool.query(
    "SELECT count(*)::int n, COALESCE(sum(down_payment),0) d FROM bike_reservations WHERE reserved_at >= date_trunc('day', now())"
  );
  const b = await pool.query(
    "SELECT count(*)::int n, COALESCE(sum(amount),0) a FROM bike_installment_payments WHERE created_at >= date_trunc('day', now())"
  );
  const c = await pool.query(
    "SELECT count(*)::int n FROM bike_reservations WHERE status = 'completed' AND completed_at >= date_trunc('day', now())"
  );
  const d = await pool.query(
    "SELECT r.id, c.full_name cust, b.model, r.down_payment FROM bike_reservations r JOIN customers c ON c.id = r.customer_id JOIN bikes b ON b.id = r.bike_id WHERE r.reserved_at >= date_trunc('day', now()) ORDER BY r.reserved_at DESC LIMIT 3"
  );
  const e = await pool.query(
    "SELECT p.id, p.amount, c.full_name cust, b.model FROM bike_installment_payments p JOIN bike_reservations r ON r.id = p.reservation_id JOIN customers c ON c.id = r.customer_id JOIN bikes b ON b.id = r.bike_id WHERE p.created_at >= date_trunc('day', now()) ORDER BY p.created_at DESC LIMIT 3"
  );
  console.log('new:', a.rows[0].n, '| down:', a.rows[0].d);
  console.log('payments:', b.rows[0].n, '| amount:', b.rows[0].a);
  console.log('completed:', c.rows[0].n);
  console.log('new-list rows:', d.rows.length, d.rows[0] ? `(${d.rows[0].cust} / ${d.rows[0].model})` : '');
  console.log('pay-list rows:', e.rows.length, e.rows[0] ? `(${e.rows[0].cust} / ${e.rows[0].model})` : '');
  await pool.end();
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});


