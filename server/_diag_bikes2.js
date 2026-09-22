require('dotenv').config();
const { many } = require('./src/db');

(async () => {
  // 1. Every reservation with its bike's current status
  const rows = await many(`
    SELECT r.id, r.status AS res_status, r.total_price, r.balance, r.down_payment,
           b.status AS bike_status, b.vin, b.model, b.sold_at
    FROM bike_reservations r
    JOIN bikes b ON b.id = r.bike_id
    ORDER BY r.created_at DESC
    LIMIT 25
  `);
  console.log('--- reservations joined to bikes ---');
  for (const r of rows) {
    console.log(
      `res=${r.res_status} bal=${r.balance}/${r.total_price} | bike=${r.bike_status} sold_at=${r.sold_at} | ${r.model} ${String(r.vin).slice(-6)}`
    );
  }

  // 2. Fully paid (or completed) reservations whose bike is NOT sold  => the bug
  const bad = await many(`
    SELECT r.id, r.status AS res_status, r.balance, b.status AS bike_status, b.vin, b.model
    FROM bike_reservations r
    JOIN bikes b ON b.id = r.bike_id
    WHERE (r.balance <= 0.01 OR r.status = 'completed')
      AND b.status <> 'sold'
  `);
  console.log(`\n--- fully paid but bike NOT sold: ${bad.length} ---`);
  for (const r of bad) console.log(`${r.model} ${r.vin} res=${r.res_status} bal=${r.balance} bike=${r.bike_status}`);

  // 3. Bike status distribution
  const dist = await many(`SELECT status, count(*)::int AS n FROM bikes GROUP BY status ORDER BY n DESC`);
  console.log('\n--- bike status distribution ---');
  for (const d of dist) console.log(`${d.status}: ${d.n}`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
