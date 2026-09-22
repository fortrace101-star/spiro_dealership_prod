require('dotenv').config();
const { many } = require('./src/db');

(async () => {
  console.log('=== BIKES ===');
  const bikes = await many(`SELECT id, vin, model, status, sold_at, sold_price, customer_id, selling_price, reserved_at FROM bikes ORDER BY model`);
  for (const b of bikes) {
    const paid = await many(`SELECT COALESCE(SUM(amount),0)::int AS paid FROM bike_installment_payments WHERE reservation_id IN (SELECT id FROM bike_reservations WHERE bike_id=$1)`, [b.id]);
    const res = await many(`SELECT id, status, total_price::int AS total, balance::int AS bal FROM bike_reservations WHERE bike_id=$1`, [b.id]);
    console.log(`${b.model} | ${b.vin} | status=${b.status} | sold_at=${b.sold_at || '—'} | paid=${paid[0].paid}`);
    for (const r of res) console.log(`    reservation ${r.id.slice(0,8)} status=${r.status} total=${r.total} balance=${r.bal}`);
  }

  console.log('\n=== FULLY-PAID BUT NOT SOLD ===');
  const bad = await many(`
    SELECT b.id, b.vin, b.model, b.status, r.id AS res_id, r.status AS res_status, r.total_price::int AS total,
           COALESCE((SELECT SUM(amount)::int FROM bike_installment_payments p WHERE p.reservation_id = r.id),0) AS paid
    FROM bike_reservations r JOIN bikes b ON b.id = r.bike_id
    WHERE r.status <> 'cancelled'
  `);
  let found = 0;
  for (const row of bad) {
    const fullyPaid = row.paid >= row.total && row.total > 0;
    if (fullyPaid && row.status !== 'sold') { found++; console.log('MISMATCH:', JSON.stringify(row)); }
  }
  console.log(`mismatches: ${found}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
