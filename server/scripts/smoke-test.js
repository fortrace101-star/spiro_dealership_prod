/* End-to-end smoke test against a running API on :4000 */
const BASE = 'http://localhost:4000'
let pass = 0
let fail = 0

function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  \u2713 ${name}`)
  } else {
    fail++
    console.log(`  \u2717 FAIL: ${name} ${extra}`)
  }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}

async function main() {
  console.log('\n== Health ==')
  const health = await req('GET', '/api/health')
  check('GET /api/health', health.status === 200 && health.json.ok === true)

  console.log('\n== Auth ==')
  const badLogin = await req('POST', '/api/auth/login', { email: 'admin@spiro.demo', password: 'wrong' })
  check('login rejects bad password', badLogin.status === 401)

  const admin = await req('POST', '/api/auth/login', { email: 'admin@spiro.demo', password: 'admin123' })
  check('admin login', admin.status === 200 && admin.json.token)
  const adminTok = admin.json.token

  const cashier = await req('POST', '/api/auth/login', { email: 'grace@spiro.demo', password: 'cashier123' })
  check('cashier login', cashier.status === 200 && cashier.json.token)
  const cashTok = cashier.json.token

  const me = await req('GET', '/api/auth/me', null, cashTok)
  check('GET /api/auth/me', me.status === 200 && me.json.user.role === 'cashier')

  const noAuth = await req('GET', '/api/reports/today')
  check('protected route rejects missing token', noAuth.status === 401)

  console.log('\n== Reports (today defaults) ==')
  const today = await req('GET', '/api/reports/today', null, adminTok)
  check('GET /api/reports/today', today.status === 200 && typeof today.json.today.revenue === 'number')
  check('today has sales seeded', today.json.today.sales_count > 0, `(got ${today.json.today.sales_count})`)

  const hourly = await req('GET', '/api/reports/today/hourly', null, adminTok)
  check('GET /api/reports/today/hourly', hourly.status === 200 && hourly.json.series.length > 0)

  const low = await req('GET', '/api/reports/low-stock', null, adminTok)
  check('GET /api/reports/low-stock (reorder alerts)', low.status === 200 && low.json.products.length > 0)

  console.log('\n== Catalog ==')
  const catalog = await req('GET', '/api/pos/catalog', null, cashTok)
  check('GET /api/pos/catalog', catalog.status === 200 && catalog.json.products.length > 0)
  const product = catalog.json.products.find((p) => p.stock_qty > 2)
  const bike = catalog.json.bikes[0]

  console.log('\n== Online sale (POS) ==')
  const txnId = `smoke-${Date.now()}`
  const salePayload = {
    client_txn_id: txnId,
    device_id: 'SMOKE-POS',
    subtotal: product.selling_price * 2,
    discount: 0,
    total: product.selling_price * 2,
    cost_total: product.cost_price * 2,
    payment_method: 'cash',
    amount_paid: product.selling_price * 2,
    change_due: 0,
    customer: { name: 'Smoke Tester', phone: '+256779999' },
    items: [{
      product_id: product.id, name: product.name, kind: 'part',
      qty: 2, unit_price: Number(product.selling_price), unit_cost: Number(product.cost_price),
      line_total: product.selling_price * 2,
    }],
  }
  const stockBefore = catalog.json.products.find((p) => p.id === product.id).stock_qty

  const sale1 = await req('POST', '/api/pos/sales', salePayload, cashTok)
  check('POST /api/pos/sales (201)', sale1.status === 201 && sale1.json.sale.receipt_no.startsWith('SR-'), JSON.stringify(sale1.json).slice(0, 120))
  const receipt = sale1.json?.sale?.receipt_no

  const saleAfterRes = await req('GET', '/api/pos/catalog', null, cashTok)
  const stockAfter = saleAfterRes.json.products.find((p) => p.id === product.id).stock_qty
  check('stock deducted by sale', stockAfter === stockBefore - 2, `(${stockBefore} -> ${stockAfter})`)

  console.log('\n== Idempotency (POS.md \u00a722) ==')
  const saleRetry = await req('POST', '/api/pos/sales', salePayload, cashTok)
  check('retry same client_txn_id -> duplicate:true, 200',
    saleRetry.status === 200 && saleRetry.json.duplicate === true && saleRetry.json.sale.receipt_no === receipt)

  console.log('\n== Offline sync push (/api/sync/push) ==')
  const offlineTxn = `smoke-offline-${Date.now()}`
  const offlineSale = {
    client_txn_id: offlineTxn,
    device_id: 'SMOKE-OFFLINE',
    subtotal: 10000, discount: 0, total: 10000, cost_total: 5000,
    payment_method: 'mobile_money', amount_paid: 10000, change_due: 0,
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    items: [{ product_id: product.id, name: product.name, kind: 'part', qty: 1, unit_price: 10000, unit_cost: 5000, line_total: 10000 }],
  }
  const push1 = await req('POST', '/api/sync/push', { sales: [offlineSale] }, cashTok)
  check('push accepts offline sale', push1.status === 200 && push1.json.accepted.length === 1, JSON.stringify(push1.json).slice(0, 140))
  const push2 = await req('POST', '/api/sync/push', { sales: [offlineSale] }, cashTok)
  check('re-push same sale -> duplicate, not double-counted',
    push2.status === 200 && push2.json.duplicates.length === 1 && push2.json.accepted.length === 0)

  console.log('\n== Controls: approvals ==')
  const creditSale = await req('POST', '/api/pos/sales', {
    client_txn_id: `smoke-credit-${Date.now()}`,
    device_id: 'SMOKE-POS',
    subtotal: 50000, discount: 0, total: 50000, cost_total: 30000,
    payment_method: 'credit', amount_paid: 0, change_due: 0,
    customer: { name: 'Credit Customer', phone: '+256778888' },
    items: [{ product_id: product.id, name: product.name, kind: 'part', qty: 1, unit_price: 50000, unit_cost: 30000, line_total: 50000 }],
  }, cashTok)
  check('credit sale recorded', creditSale.status === 201)

  const approvals = await req('GET', '/api/admin/approvals?status=pending', null, adminTok)
  check('credit sale created approval request', approvals.json.approvals.some((a) => a.type === 'credit_sale'))
  const creditApproval = approvals.json.approvals.find((a) => a.type === 'credit_sale')

  const cashierApprove = await req('POST', `/api/admin/approvals/${creditApproval.id}/decide`, { decision: 'approved' }, cashTok)
  check('cashier cannot decide approvals (403)', cashierApprove.status === 403)

  const approved = await req('POST', `/api/admin/approvals/${creditApproval.id}/decide`, { decision: 'approved', note: 'ok' }, adminTok)
  check('admin approves', approved.status === 200 && approved.json.approval.status === 'approved')

  console.log('\n== Controls: roles ==')
  const cashierProduct = await req('POST', '/api/admin/products', { sku: 'X', name: 'X' }, cashTok)
  check('cashier cannot create products (403)', cashierProduct.status === 403)
  const cashierAdjust = await req('POST', '/api/admin/inventory/adjust', { product_id: product.id, qty: 5 }, cashTok)
  check('cashier cannot adjust stock (403)', cashierAdjust.status === 403)

  console.log('\n== Inventory adjustment + movements ==')
  // Fresh baseline: earlier tests (offline push, credit sale) also deducted units
  const preAdjRes = await req('GET', '/api/pos/catalog', null, cashTok)
  const preAdj = preAdjRes.json.products.find((p) => p.id === product.id).stock_qty
  const adj = await req('POST', '/api/admin/inventory/adjust', { product_id: product.id, qty: 10, note: 'smoke restock', type: 'purchase' }, adminTok)
  check('admin stock adjustment', adj.status === 201 && adj.json.stock_qty === preAdj + 10, `(expected ${preAdj + 10}, got ${adj.json?.stock_qty})`)
  const movements = await req('GET', `/api/admin/inventory/movements?product_id=${product.id}`, null, adminTok)
  check('movement ledger has sale + purchase rows', movements.json.movements.some((m) => m.type === 'sale') && movements.json.movements.some((m) => m.type === 'purchase'))

  console.log('\n== Audit trail ==')
  const audit = await req('GET', '/api/admin/audit', null, adminTok)
  check('audit has entries', audit.status === 200 && audit.json.entries.length > 0)
  check('audit records stock_adjustment', audit.json.entries.some((e) => e.action === 'stock_adjustment'))

  console.log('\n== VIN 360 lookup ==')
  const bikes = await req('GET', '/api/admin/bikes', null, adminTok)
  const inStock = bikes.json.bikes.find((b) => b.status === 'in_stock')
  const vin = await req('GET', `/api/admin/bikes/lookup/${inStock.vin}`, null, adminTok)
  check('VIN lookup returns bike', vin.status === 200 && vin.json.bike.vin === inStock.vin)

  // No top-level bike_id — exactly what the POS PWA sends (bike only on the item)
  const vinSale = await req('POST', '/api/pos/sales', {
    client_txn_id: `smoke-bike-${Date.now()}`,
    device_id: 'SMOKE-POS',
    subtotal: Number(inStock.selling_price), discount: 0, total: Number(inStock.selling_price),
    cost_total: Number(inStock.cost_price),
    payment_method: 'bank', amount_paid: Number(inStock.selling_price), change_due: 0,
    customer: { name: 'Bike Buyer', phone: '+256777777' },
    items: [{ bike_id: inStock.id, name: `${inStock.model} (${inStock.color})`, kind: 'bike', qty: 1, unit_price: Number(inStock.selling_price), unit_cost: Number(inStock.cost_price), line_total: Number(inStock.selling_price) }],
  }, cashTok)
  check('bike sale recorded', vinSale.status === 201)
  const vinAfter = await req('GET', `/api/admin/bikes/lookup/${inStock.vin}`, null, adminTok)
  check('bike marked sold + customer assigned after sale',
    vinAfter.json.bike.status === 'sold' && vinAfter.json.bike.customer_name === 'Bike Buyer' && vinAfter.json.sales.length === 1)

  console.log('\n== Customers (CRM) ==')
  const customers = await req('GET', '/api/admin/customers?q=Smoke', null, adminTok)
  check('customer auto-created from sale', customers.status === 200 && customers.json.customers.some((c) => c.phone === '+256779999'))
  const custId = customers.json.customers[0]?.id
  if (custId) {
    const cust = await req('GET', `/api/admin/customers/${custId}`, null, adminTok)
    check('customer 360 has purchase history', cust.status === 200 && cust.json.purchases.length >= 1)
  }

  console.log('\n== Activation codes ==')
  const code = await req('POST', '/api/admin/codes', { label: 'smoke test code', role: 'cashier', days: 7 }, adminTok)
  check('admin generates code', code.status === 201 && code.json.code.code.startsWith('SPIRO-'))
  const reg = await req('POST', '/api/auth/register', { code: code.json.code.code, full_name: 'Smoke Operator', password: 'operator123', device_id: 'SMOKE-DEV' })
  check('operator self-registers with code', reg.status === 201 && reg.json.user.role === 'cashier')
  const regReuse = await req('POST', '/api/auth/register', { code: code.json.code.code, full_name: 'Again', password: 'operator123' })
  check('used code cannot be reused', regReuse.status === 400)

  console.log('\n== Admin sales list ==')
  const salesList = await req('GET', '/api/admin/sales?days=7&limit=5', null, adminTok)
  check('GET /api/admin/sales with names', salesList.status === 200 && salesList.json.sales.length > 0 && salesList.json.sales[0].cashier_name)
  const detail = await req('GET', `/api/admin/sales/${sale1.json.sale.id}`, null, adminTok)
  check('sale detail includes items', detail.status === 200 && detail.json.items.length === 1)

  console.log(`\n========== RESULT: ${pass} passed, ${fail} failed ==========\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
