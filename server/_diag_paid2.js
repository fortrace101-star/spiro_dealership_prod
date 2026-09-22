require('dotenv').config();
const { many } = require('./src/db');

(async () => {
  const bikes = await many(`SELECT id, vin, model, status, sold_at, sold_price FROM bikes ORDER BY model`);
  console.log('=== BIKES ===');
  for (const b of bikes) {
    console.log(`${b.model.padEnd(22)} | ${b.status.padEnd(10)} | sold_at=${b.sold_at ? new Date(b.sold_at).toISOString().slice(0, 10) : '-'} | vin=${b.vin}`);
  }

  const res = await many(
    `SELECT r.id, r.status, r.total_price, r.down_payment, r.balance, r.bike_id,
            b.vin, b.model, b.status AS bike_status
     FROM bike_reservations r
     LEFT JOIN bikes b ON b.id = r.bike_id
     ORDER BY r.created_at DESC`
  );
  console.log('\n=== RESERVATIONS ===');
  for (const r of res) {
    console.log(
      `${r.status.padEnd(10)} | bal=${String(r.balance).padStart(9)} | bike=${(r.model || '?').padEnd(20)} | bike_status=${r.bike_status || '?'} | ${r.vin || ''}`
    );
  }

  const bad = res.filter((r) => Number(r.balance) <= 0.01 && r.bike_status !== 'sold');
  console.log(`\n=== FULLY PAID BUT BIKE NOT SOLD: ${bad.length} ===`);
  for (const r of bad) console.log(`reservation ${r.id} status=${r.status} bike=${r.model} bike_status=${r.bike_status}`);

  const stuck = res.filter((r) => Number(r.balance) <= 0.01 && r.status === 'active');
  console.log(`=== FULLY PAID BUT RESERVATION STILL ACTIVE: ${stuck.length} ===`);
  for (const r of stuck) console.log(`reservation ${r.id} bike=${r.model} bike_status=${r.bike_status}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
