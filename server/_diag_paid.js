/* Temporary diagnostic: find bikes that are fully paid but not marked sold. */
require('dotenv').config();
const { many } = require('./src/db');

(async () => {
  try {
    const cols = await many(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'bike_reservations' ORDER BY ordinal_position`
    );
    console.log('bike_reservations columns:', cols.map((c) => c.column_name).join(', '));

    const bikes = await many(
      `SELECT id, vin, model, status, sold_at, sold_price, customer_id
       FROM bikes ORDER BY created_at DESC LIMIT 20`
    );
    console.log('\n--- bikes (latest 20) ---');
    for (const b of bikes) console.log(`${b.vin} | ${b.model} | status=${b.status} | sold_at=${b.sold_at || '-'}`);

    const res = await many(
      `SELECT id, bike_id, status, total_price, balance, completed_at
       FROM bike_reservations ORDER BY created_at DESC LIMIT 20`
    );
    console.log('\n--- reservations (latest 20) ---');
    for (const r of res) {
      const b = bikes.find((x) => x.id === r.bike_id);
      console.log(
        `res=${r.id.slice(0, 8)} | bike=${b ? b.vin : r.bike_id} | resStatus=${r.status} | balance=${r.balance} | bikeStatus=${b ? b.status : '?'}`
      );
    }

    // the actual audit: fully paid reservations whose bike is not sold
    const bad = await many(
      `SELECT r.id, r.status AS res_status, r.balance, b.vin, b.status AS bike_status
       FROM bike_reservations r JOIN bikes b ON b.id = r.bike_id
       WHERE (r.status = 'completed' OR r.balance <= 0) AND b.status <> 'sold'`
    );
    console.log(`\n=== fully-paid-but-not-sold: ${bad.length} ===`);
    for (const x of bad) console.log(JSON.stringify(x));

    const counts = await many(`SELECT status, count(*)::int AS n FROM bikes GROUP BY status ORDER BY status`);
    console.log('\nbike status counts:', JSON.stringify(counts));
  } catch (e) {
    console.error('DIAG ERROR:', e.message);
  }
  process.exit(0);
})();
