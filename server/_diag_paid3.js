const { many } = require('./src/db');
(async () => {
  const rows = await many(`
    SELECT r.id, r.status AS res_status, r.total_price, r.down_payment, r.balance,
           b.id AS bike_id, b.vin, b.model, b.status AS bike_status, b.sold_at
    FROM bike_reservations r
    JOIN bikes b ON b.id = r.bike_id
    ORDER BY r.created_at DESC`);
  console.log('=== reservations + bike status ===');
  for (const r of rows) {
    console.log(`${r.bike_status.padEnd(10)} | bal=${String(r.balance).padStart(10)} | res=${r.res_status.padEnd(10)} | ${r.vin} ${r.model} | sold_at=${r.sold_at || '-'}`);
  }
  const paidNotSold = rows.filter((r) => Number(r.balance) <= 0.01 && r.bike_status !== 'sold');
  console.log(`\nfully paid but NOT sold: ${paidNotSold.length}`);
  const all = await many(`SELECT status, count(*)::int AS n FROM bikes GROUP BY status ORDER BY status`);
  console.log('=== bikes by status ===');
  console.log(all);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
