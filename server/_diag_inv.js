require('dotenv').config()
const { many } = require('./src/db')

async function main() {
  console.log('=== BIKES + their reservations ===')
  const rows = await many(`
    SELECT b.id, b.model, b.vin, b.status AS bike_status, b.sold_at,
           r.id AS resv_id, r.status AS resv_status, r.total_price, r.balance,
           (SELECT COALESCE(SUM(amount),0) FROM bike_installment_payments p WHERE p.reservation_id = r.id) AS paid
    FROM bikes b
    LEFT JOIN bike_reservations r ON r.bike_id = b.id
    ORDER BY b.model, r.created_at DESC NULLS LAST`)
  for (const r of rows) {
    console.log(`bike=${r.model} | vin=${r.vin} | bike_status=${r.bike_status} | resv=${r.resv_status || '-'} | total=${r.total_price || '-'} | balance=${r.balance ?? '-'} | paid=${r.paid} | sold_at=${r.sold_at ? 'y' : 'n'}`)
  }

  console.log('\n=== MISMATCH: fully paid but bike NOT sold ===')
  const bad = await many(`
    SELECT b.model, b.vin, b.status AS bike_status, r.status AS resv_status, r.balance,
           (SELECT COALESCE(SUM(amount),0) FROM bike_installment_payments p WHERE p.reservation_id = r.id) AS paid,
           r.total_price
    FROM bikes b JOIN bike_reservations r ON r.bike_id = b.id
    WHERE b.status <> 'sold'
      AND (r.balance <= 0.01
           OR (SELECT COALESCE(SUM(amount),0) FROM bike_installment_payments p WHERE p.reservation_id = r.id) >= r.total_price - 0.01)`)
  console.log(bad.length === 0 ? '  none — all fully-paid bikes are sold' : JSON.stringify(bad, null, 2))

  console.log('\n=== bikes with NO reservation ===')
  const nors = await many(`SELECT model, vin, status FROM bikes WHERE id NOT IN (SELECT bike_id FROM bike_reservations) ORDER BY model`)
  console.log(nors.length === 0 ? '  none' : JSON.stringify(nors))

  console.log('\n=== reservation status tally ===')
  const tally = await many(`SELECT status, count(*)::int AS n FROM bike_reservations GROUP BY status ORDER BY status`)
  console.log(JSON.stringify(tally))
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e.message); process.exit(1) })
