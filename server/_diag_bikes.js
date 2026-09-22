require('dotenv').config()
const { many } = require('./src/db')

;(async () => {
  const bikes = await many(
    `SELECT b.id, b.model, b.vin, b.status, b.sold_at, b.sold_price, b.reserved_at,
            r.id AS res_id, r.status AS res_status, r.total_price, r.down_payment, r.balance
     FROM bikes b
     LEFT JOIN bike_reservations r ON r.bike_id = b.id
     ORDER BY b.created_at DESC NULLS LAST
     LIMIT 30`
  )
  for (const b of bikes) {
    console.log(
      `${(b.status || '?').padEnd(9)} | res=${(b.res_status || '-').padEnd(10)} bal=${String(b.balance ?? '-').padStart(10)} | ${b.model} ${String(b.vin).slice(-8)}`
    )
  }
  const bad = await many(
    `SELECT b.id, b.model, b.vin, b.status, r.status AS res_status, r.balance
       FROM bikes b
       JOIN bike_reservations r ON r.bike_id = b.id
      WHERE (r.balance <= 0.01 OR r.status = 'completed') AND b.status <> 'sold'`
  )
  console.log('\n--- fully paid but NOT sold:', bad.length)
  for (const b of bad) console.log(' ', b.model, b.vin, 'bike=' + b.status, 'res=' + b.res_status, 'bal=' + b.balance)
  process.exit(0)
})().catch((e) => { console.error(e.message); process.exit(1) })
