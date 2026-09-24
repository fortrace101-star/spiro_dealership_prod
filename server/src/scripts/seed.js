/**
 * Seed: creates the first admin, activation codes, demo catalog,
 * demo bikes (VIN-tracked), customers, and a realistic week of sales
 * (including several TODAY so the dashboard default view has data).
 * Safe to re-run: wipes and recreates demo rows.
 */
require('dotenv').config();
// Demo rows are for development only — never write them into a production
// install. Production gets its first administrator via first-time setup.
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV=production. Create the first administrator via first-time setup instead.');
  process.exit(1);
}
const { pool, one, many, initSchema } = require('../db');
const { hashPassword } = require('../auth');

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const between = (min, max) => min + rand(max - min + 1);

async function wipeDemo() {
  // Children first
  await pool.query(`DELETE FROM audit_log`);
  await pool.query(`DELETE FROM push_subscriptions`);
  await pool.query(`DELETE FROM stock_movements`);
  await pool.query(`DELETE FROM sale_items`);
  await pool.query(`DELETE FROM sales`);
  await pool.query(`DELETE FROM approvals`);
  await pool.query(`DELETE FROM customer_bikes`);
  await pool.query(`UPDATE bikes SET customer_id = NULL`);
  await pool.query(`DELETE FROM bikes`);
  await pool.query(`DELETE FROM products`);
  await pool.query(`DELETE FROM customers WHERE phone LIKE '+25677%'`);
  await pool.query(`DELETE FROM activation_codes`);
  await pool.query(`DELETE FROM users WHERE email LIKE '%@spiro.demo'`);
}

async function main() {
  await initSchema();
  await wipeDemo();

  // ---- Admin user ----
  let admin = await one(`SELECT * FROM users WHERE email = $1`, ['admin@spiro.demo']);
  if (!admin) {
    admin = await one(
      `INSERT INTO users (full_name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin') RETURNING *`,
      ['Spiro Admin', 'admin@spiro.demo', '+256700000001', await hashPassword('admin123')]
    );
    console.log('  ✓ admin@spiro.demo / admin123');
  }

  // ---- Manager + cashiers (POS operator accounts) ----
  const manager = await one(
    `INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1,$2,$3,$4,'manager') RETURNING *`,
    ['David Okello', 'manager@spiro.demo', '+256700000002', await hashPassword('manager123')]
  );
  const cashier1 = await one(
    `INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1,$2,$3,$4,'operator') RETURNING *`,
    ['Grace Amina', 'grace@spiro.demo', '+256700000003', await hashPassword('cashier123')]
  );
  const cashier2 = await one(
    `INSERT INTO users (full_name, email, phone, password_hash, role) 
     VALUES ($1,$2,$3,$4,'operator') RETURNING *`,
    ['Peter Mugisha', 'peter@spiro.demo', '+256700000004', await hashPassword('cashier123')]
  );
  console.log('  ✓ staff: manager@spiro.demo/manager123, grace@spiro.demo/cashier123, peter@spiro.demo/cashier123');

  // ---- Activation codes ----
  for (const c of [
    { code: 'SPIRO-DEMO1', label: 'Demo counter 1', role: 'operator' },
    { code: 'SPIRO-DEMO2', label: 'Demo counter 2', role: 'operator' },
    { code: 'SPIRO-MGR1', label: 'Demo manager', role: 'manager' },
  ]) {
    await one(
      `INSERT INTO activation_codes (code, label, role, created_by, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '30 days')`,
      [c.code, c.label, c.role, admin.id]
    );
  }
  console.log('  ✓ codes: SPIRO-DEMO1, SPIRO-DEMO2, SPIRO-MGR1 (30 days)');

  // ---- Products: Spiro spare parts & accessories ----
  const catalog = [
    ['BAT-LFP-60', '6341727100289', 'Spiro Battery 60V 30Ah LFP', 'Spare Parts', 'Spiro', 'Spiro Uganda', 1450000, 1890000, 14, 5, 8],
    ['BAT-LFP-32', '6341727100296', 'Spiro Battery 32Ah LFP', 'Spare Parts', 'Spiro', 'Spiro Uganda', 920000, 1240000, 9, 4, 6],
    ['CHR-60V', '6341727100302', '60V Smart Charger', 'Accessories', 'Spiro', 'Spiro Uganda', 210000, 295000, 25, 6, 10],
    ['TYR-9090', '6341727100319', 'Tubeless Tyre 90/90-12', 'Spare Parts', 'MRF', 'MRF Tyres UG', 95000, 145000, 42, 10, 15],
    ['TYR-1008', '6341727100326', 'Tubeless Tyre 100/80-10', 'Spare Parts', 'MRF', 'MRF Tyres UG', 88000, 135000, 3, 6, 8],
    ['BRK-PAD-F', '6341727100333', 'Front Brake Pads Set', 'Spare Parts', 'Spiro', 'Spiro Uganda', 24000, 45000, 60, 15, 20],
    ['BRK-PAD-R', '6341727100340', 'Rear Brake Shoes', 'Spare Parts', 'Spiro', 'Spiro Uganda', 26000, 48000, 2, 10, 15],
    ['CTL-DCDC', '6341727100357', 'DC-DC Converter 60V→12V', 'Spare Parts', 'Spiro', 'Spiro Uganda', 130000, 198000, 11, 4, 6],
    ['CTL-HRN', '6341727100364', 'Main Wiring Harness', 'Spare Parts', 'Spiro', 'Spiro Uganda', 165000, 240000, 6, 3, 5],
    ['MTR-3000', '6341727100371', 'Hub Motor 3000W', 'Spare Parts', 'Spiro', 'Spiro Uganda', 1150000, 1520000, 4, 2, 3],
    ['MTR-2000', '6341727100388', 'Hub Motor 2000W', 'Spare Parts', 'Spiro', 'Spiro Uganda', 980000, 1320000, 2, 2, 3],
    ['SUS-FRK', '6341727100395', 'Front Fork Assembly', 'Spare Parts', 'Spiro', 'Spiro Uganda', 310000, 420000, 7, 3, 5],
    ['LGT-LED-H', '6341727100401', 'LED Headlamp Unit', 'Accessories', 'Spiro', 'Spiro Uganda', 72000, 118000, 18, 5, 8],
    ['LGT-LED-T', '6341727100418', 'LED Tail Light', 'Accessories', 'Spiro', 'Spiro Uganda', 31000, 56000, 22, 6, 10],
    ['MIR-L', '6341727100425', 'Mirror Left', 'Accessories', 'Spiro', 'Spiro Uganda', 15000, 28000, 35, 8, 12],
    ['MIR-R', '6341727100432', 'Mirror Right', 'Accessories', 'Spiro', 'Spiro Uganda', 15000, 28000, 31, 8, 12],
    ['HLM-XXL', '6341727100439', 'Rider Helmet XL', 'Accessories', 'Generic', 'Safeway Accessories', 85000, 135000, 16, 4, 6],
    ['GLV-RID', '6341727100446', 'Riding Gloves', 'Accessories', 'Generic', 'Safeway Accessories', 22000, 38000, 28, 6, 10],
    ['CHN-428', '6341727100453', 'Drive Chain 428H', 'Spare Parts', 'Generic', 'Spiro Uganda', 48000, 79000, 0, 4, 6],
    ['BLT-BELT', '6341727100460', 'Drive Belt', 'Spare Parts', 'Generic', 'Spiro Uganda', 38000, 64000, 13, 4, 6],
    ['RGU-MUD', '6341727100477', 'Rear Mudguard', 'Spare Parts', 'Spiro', 'Spiro Uganda', 29000, 52000, 12, 4, 6],
    ['GRIP-PR', '6341727100484', 'Handlebar Grip Pair', 'Consumables', 'Generic', 'Safeway Accessories', 8000, 16000, 44, 10, 15],
    ['FUS-30A', '6341727100491', 'Fuse 30A', 'Consumables', 'Generic', 'Spiro Uganda', 3000, 7000, 90, 20, 30],
    ['BLB-12V', '6341727100507', '12V Bulb', 'Consumables', 'Generic', 'Spiro Uganda', 4000, 9000, 1, 10, 15],
  ];
  const products = [];
  for (const [sku, barcode, name, category, brand, supplier, cost, price, qty, minS, reorder] of catalog) {
    products.push(await one(
      `INSERT INTO products (sku, barcode, name, category, brand, supplier, cost_price, selling_price, stock_qty, min_stock, reorder_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sku, barcode, name, category, brand, supplier, cost, price, qty, minS, reorder]
    ));
  }
  console.log(`  ✓ ${products.length} products`);

  // ---- Bikes: VIN-tracked Spiro Ekon / Zipp fleet ----
  const bikeDefs = [
    ['SPK-EK-2024-0011', 'Spiro Ekon 100', 'Matte Black', 2024, 'MTR-EK-88112', 'BAT-EK-55231', '60V 32Ah LFP', 0, 3450000, 4250000],
    ['SPK-EK-2024-0012', 'Spiro Ekon 100', 'Pearl White', 2024, 'MTR-EK-88113', 'BAT-EK-55232', '60V 32Ah LFP', 0, 3450000, 4250000],
    ['SPK-EK-2024-0013', 'Spiro Ekon 100', 'Spiro Green', 2024, 'MTR-EK-88114', 'BAT-EK-55233', '60V 32Ah LFP', 0, 3450000, 4250000],
    ['SPK-EK-2025-0021', 'Spiro Ekon 150', 'Spiro Green', 2025, 'MTR-EK-91001', 'BAT-EK-60001', '72V 45Ah LFP', 0, 4600000, 5650000],
    ['SPK-EK-2025-0022', 'Spiro Ekon 150', 'Matte Black', 2025, 'MTR-EK-91002', 'BAT-EK-60002', '72V 45Ah LFP', 0, 4600000, 5650000],
    ['SPK-ZP-2025-0031', 'Spiro Zipp', 'Red', 2025, 'MTR-ZP-20114', 'BAT-ZP-31007', '60V 30Ah LFP', 0, 2900000, 3650000],
    ['SPK-ZP-2025-0032', 'Spiro Zipp', 'Blue', 2025, 'MTR-ZP-20115', 'BAT-ZP-31008', '60V 30Ah LFP', 0, 2900000, 3650000],
    ['SPK-ZP-2025-0033', 'Spiro Zipp', 'Black', 2025, 'MTR-ZP-20116', 'BAT-ZP-31009', '60V 30Ah LFP', 0, 2900000, 3650000],
  ];
  const bikes = [];
  for (const [vin, model, color, year, motor, bat, batSpec, odo, cost, price] of bikeDefs) {
    bikes.push(await one(
      `INSERT INTO bikes (vin, model, color, year, motor_number, battery_serial, battery_spec, odometer_km, cost_price, selling_price, status, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'in_stock','Main showroom') RETURNING *`,
      [vin, model, color, year, motor, bat, batSpec, odo, cost, price]
    ));
  }
  console.log(`  ✓ ${bikes.length} bikes in stock (VIN-tracked)`);

  // ---- Customers ----
  const custDefs = [
    ['Joseph Ssekandi', '+256771001', 'joseph.s@example.ug', 'Kampala, Ndeeba'],
    ['Mariam Nakato', '+256771002', null, 'Nansana'],
    ['Emmanuel Okot', '+256771003', null, 'Gulu'],
    ['Sarah Achieng', '+256771004', null, 'Jinja'],
    ['Robert Kato', '+256771005', null, 'Kampala, Kisenyi'],
    ['Bosco Odongo', '+256771006', null, 'Lira'],
  ];
  const customers = [];
  for (const [name, phone, email, address] of custDefs) {
    customers.push(await one(
      `INSERT INTO customers (full_name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, phone, email, address]
    ));
  }
  console.log(`  ✓ ${customers.length} customers`);

  // ---- Sales history: 13 days back + a busy TODAY ----
  const cashiers = [manager, cashier1, cashier2];
  const payMethods = ['cash', 'mobile_money', 'cash', 'mobile_money', 'bank', 'card'];
  const receiptCounters = {};
  let txnCounter = 1;

  async function makeSale(saleDate, cashier, customer, bike, itemPlan) {
    const stamp = `${saleDate.getFullYear()}${String(saleDate.getMonth() + 1).padStart(2, '0')}${String(saleDate.getDate()).padStart(2, '0')}`;
    receiptCounters[stamp] = (receiptCounters[stamp] || 0) + 1;
    const receiptNo = `SR-${stamp}-${String(receiptCounters[stamp]).padStart(4, '0')}`;
    const clientTxnId = `seed-${stamp}-${txnCounter++}`;
    const paymentMethod = itemPlan.kind === 'bike' ? pick(['mobile_money', 'bank', 'card']) : pick(payMethods);

    let subtotal = 0, costTotal = 0;
    const items = [];
    if (itemPlan.kind === 'bike') {
      subtotal = Number(bike.selling_price);
      costTotal = Number(bike.cost_price);
      items.push({ kind: 'bike', bike_id: bike.id, name: `${bike.model} (${bike.color})`, qty: 1, unit_price: Number(bike.selling_price), unit_cost: Number(bike.cost_price), line_total: Number(bike.selling_price) });
    } else {
      for (const [prod, qty] of itemPlan.items) {
        const price = Number(prod.selling_price);
        const cost = Number(prod.cost_price);
        const line = price * qty;
        subtotal += line;
        costTotal += cost * qty;
        items.push({ kind: 'part', product_id: prod.id, name: prod.name, qty, unit_price: price, unit_cost: cost, line_total: line });
      }
    }

    const discount = itemPlan.discount || 0;
    const total = subtotal - discount;
    const paid = paymentMethod === 'credit' ? 0 : total;
    const pad = (n) => String(n).padStart(2, '0');
    const createdAt = `${saleDate.getFullYear()}-${pad(saleDate.getMonth() + 1)}-${pad(saleDate.getDate())} ${pad(saleDate.getHours())}:${pad(saleDate.getMinutes())}:00+03`;

    const sale = await one(
      `INSERT INTO sales (client_txn_id, receipt_no, cashier_id, customer_id, bike_id, subtotal, discount, total, cost_total, profit, payment_method, amount_paid, change_due, device_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,'completed',$14) RETURNING *`,
      [clientTxnId, receiptNo, cashier.id, customer?.id || null, itemPlan.kind === 'bike' ? bike.id : null,
       subtotal, discount, total, costTotal, total - costTotal, paymentMethod, paid, `pos-${1000 + txnCounter}`, createdAt]
    );

    for (const it of items) {
      await one(
        `INSERT INTO sale_items (sale_id, product_id, bike_id, name, kind, qty, unit_price, unit_cost, discount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [sale.id, it.product_id || null, it.bike_id || null, it.name, it.kind, it.qty, it.unit_price, it.unit_cost, 0, it.line_total]
      );
      if (it.kind === 'bike') {
        await one(`UPDATE bikes SET status='sold', sold_at=$2, sold_price=$3, customer_id=$4 WHERE id=$1`, [it.bike_id, createdAt, it.unit_price, customer?.id || null]);
      } else {
        await one(`UPDATE products SET stock_qty = GREATEST(stock_qty - $2, 0) WHERE id = $1`, [it.product_id, it.qty]);
        await one(`INSERT INTO stock_movements (product_id, qty, type, sale_id, user_id, client_txn_id, note, created_at) VALUES ($1,$2,'sale',$3,$4,$5,$6,$7)`,
          [it.product_id, -it.qty, sale.id, cashier.id, clientTxnId, `Sale ${receiptNo}`, createdAt]);
      }
    }
    return sale;
  }

  // Historical days
  for (let d = 13; d >= 1; d--) {
    const day = new Date();
    day.setDate(day.getDate() - d);
    day.setHours(between(8, 18), between(0, 59), 0, 0);
    const salesToday = between(2, 5);
    for (let i = 0; i < salesToday; i++) {
      const isBike = Math.random() < 0.12 && d % 2 === 0;
      const customer = Math.random() < 0.7 ? pick(customers) : null;
      let plan;
      let bikeToSell = null;
      if (isBike) {
        const avail = await many(`SELECT * FROM bikes WHERE status='in_stock' LIMIT 5`);
        if (avail.length) {
          bikeToSell = pick(avail);
          plan = { kind: 'bike' };
        } else {
          plan = { kind: 'parts', items: [[pick(products), between(1, 3)]] };
        }
      } else {
        const nItems = between(1, 4);
        const items = [];
        for (let j = 0; j < nItems; j++) items.push([pick(products), between(1, 4)]);
        plan = { kind: 'parts', items, discount: Math.random() < 0.2 ? between(2000, 15000) : 0 };
      }
      await makeSale(day, pick(cashiers), customer, bikeToSell, plan);
    }
  }

  // TODAY — guaranteed busy day (dashboard default view)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPlan = [
    { hour: 8 }, { hour: 9 }, { hour: 9 }, { hour: 10 }, { hour: 11 },
    { hour: 12 }, { hour: 13 }, { hour: 14 }, { hour: 16 }, { hour: 17 },
  ];
  for (const tp of todayPlan) {
    const cashier = pick(cashiers);
    const customer = Math.random() < 0.6 ? pick(customers) : null;
    const at = new Date(today);
    at.setHours(tp.hour, between(0, 59), 0, 0);

    let plan;
    let bikeToSell = null;
    const inStockBikes = await many(`SELECT * FROM bikes WHERE status='in_stock'`);
    if (Math.random() < 0.15 && inStockBikes.length) {
      bikeToSell = pick(inStockBikes);
      plan = { kind: 'bike' };
    } else {
      const nItems = between(1, 3);
      const items = [];
      for (let j = 0; j < nItems; j++) items.push([pick(products), between(1, 3)]);
      plan = { kind: 'parts', items, discount: Math.random() < 0.25 ? between(3000, 20000) : 0 };
    }

    await makeSale(at, cashier, customer, bikeToSell, plan);
  }
  console.log('  ✓ sales history (13 days) + busy today');

  // ---- Stock purchase/adjustment movements ----
  for (const p of products.slice(0, 8)) {
    await one(`INSERT INTO stock_movements (product_id, qty, type, user_id, note) VALUES ($1,$2,'purchase',$3,'Restock')`,
      [p.id, between(10, 30), admin.id]);
  }

  // ---- Customer bike links ----
  const soldBikes = await many(`SELECT * FROM bikes WHERE status='sold' AND customer_id IS NOT NULL`);
  for (const b of soldBikes) {
    await one(`INSERT INTO customer_bikes (customer_id, bike_id) VALUES ($1,$2)`, [b.customer_id, b.id]);
  }

  // ---- One pending approval demo ----
  await one(
    `INSERT INTO approvals (type, requested_by, payload, status)
     VALUES ('discount', $1, $2, 'pending')`,
    [cashier1.id, JSON.stringify({ receipt_no: 'SR-DEMO-0099', subtotal: 200000, discount: 30000, pct: 15 })]
  );

  console.log('\nDone. Logins:');
  console.log('  Admin:   admin@spiro.demo / admin123');
  console.log('  Manager: manager@spiro.demo / manager123');
  console.log('  Cashier: grace@spiro.demo / cashier123 (POS)');
  console.log('  Codes:   SPIRO-DEMO1, SPIRO-DEMO2, SPIRO-MGR1');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
