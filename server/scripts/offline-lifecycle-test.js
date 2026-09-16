/**
 * Offline lifecycle E2E (POS.md Test F + G):
 *   1. Capture catalog baseline (stock)
 *   2. "Go offline": create 3 sales locally-in-spirit with client_txn_ids
 *   3. One of them was "half-synced" earlier (server got it, ACK was lost)
 *   4. Reconnect: push the whole batch in one /api/sync/push call
 *   5. Verify: accepted=2, duplicate=1, stock deducted exactly once per sale,
 *      receipt numbers assigned, retry of the same batch is a no-op
 */
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

function makeSale(clientTxnId, product, qty, minutesAgo) {
  const subtotal = Number(product.selling_price) * qty
  return {
    client_txn_id: clientTxnId,
    device_id: 'OFFLINE-E2E',
    subtotal,
    discount: 0,
    total: subtotal,
    cost_total: Number(product.cost_price) * qty,
    payment_method: 'cash',
    amount_paid: subtotal,
    change_due: 0,
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    items: [{
      product_id: product.id,
      name: product.name,
      kind: 'part',
      qty,
      unit_price: Number(product.selling_price),
      unit_cost: Number(product.cost_price),
      line_total: subtotal,
    }],
  }
}

async function main() {
  console.log('\n== Setup ==')
  const login = await req('POST', '/api/auth/login', { email: 'grace@spiro.demo', password: 'cashier123' })
  check('cashier login', login.status === 200)
  const tok = login.json.token

  const catalog = await req('GET', '/api/pos/catalog', null, tok)
  const product = catalog.json.products.find((p) => p.stock_qty >= 10)
  check('product with enough stock found', Boolean(product))

  console.log('\n== Simulate offline sales ==')
  const now = Date.now()
  const saleA = makeSale(`e2e-off-A-${now}`, product, 1, 50)   // will sync in batch
  const saleB = makeSale(`e2e-off-B-${now}`, product, 2, 40)   // "half-synced": server got it, ACK lost
  const saleC = makeSale(`e2e-off-C-${now}`, product, 3, 30)   // will sync in batch

  // Baseline BEFORE any e2e sale touches the server
  const stockBefore = (await req('GET', '/api/pos/catalog', null, tok)).json.products.find((p) => p.id === product.id).stock_qty

  // B reached the server earlier but the POS never saw the ACK:
  const lostAck = await req('POST', '/api/sync/push', { sales: [saleB] }, tok)
  check('half-synced sale B stored on server', lostAck.status === 200 && lostAck.json.accepted.length === 1)

  console.log('\n== Reconnect: push full offline batch (A + B + C) ==')
  const batch1 = await req('POST', '/api/sync/push', { sales: [saleA, saleB, saleC] }, tok)
  check('batch push ok', batch1.status === 200 && batch1.json.ok === true, JSON.stringify(batch1.json).slice(0, 160))
  check('A accepted', batch1.json.accepted.some((s) => s.client_txn_id === saleA.client_txn_id))
  check('B recognized as duplicate (no double-charge)', batch1.json.duplicates.includes(saleB.client_txn_id))
  check('C accepted', batch1.json.accepted.some((s) => s.client_txn_id === saleC.client_txn_id))
  check('nothing failed', batch1.json.failed.length === 0)

  const acceptedReceipts = [...batch1.json.accepted.map((s) => s.receipt_no), ...batch1.json.duplicates]
  check('all sales have receipt numbers', batch1.json.accepted.every((s) => /^SR-\d{8}-\d{4}$/.test(s.receipt_no)))

  console.log('\n== Stock deducted exactly once per sale ==')
  const qtyPushed = 1 + 2 + 3
  const stockMid = (await req('GET', '/api/pos/catalog', null, tok)).json.products.find((p) => p.id === product.id).stock_qty
  check(`stock = baseline - ${qtyPushed} (B counted once)`, stockMid === stockBefore - qtyPushed, `(${stockBefore} -> ${stockMid})`)

  console.log('\n== ACK lost again: POS retries the SAME batch ==')
  const batch2 = await req('POST', '/api/sync/push', { sales: [saleA, saleB, saleC] }, tok)
  check('retry: all duplicates, nothing new', batch2.status === 200 && batch2.json.accepted.length === 0 && batch2.json.duplicates.length === 3 && batch2.json.failed.length === 0)

  const stockAfterRetry = (await req('GET', '/api/pos/catalog', null, tok)).json.products.find((p) => p.id === product.id).stock_qty
  check('stock unchanged after retry', stockAfterRetry === stockMid, `(${stockMid} -> ${stockAfterRetry})`)

  console.log('\n== Sale-level idempotency: single-sale retry ==')
  const single = await req('POST', '/api/pos/sales', saleA, tok)
  check('POST /api/pos/sales with same txn -> duplicate', single.status === 200 && single.json.duplicate === true && single.json.sale.receipt_no === batch1.json.accepted.find((s) => s.client_txn_id === saleA.client_txn_id).receipt_no)

  console.log('\n== Server state consistent ==')
  const movements = (await req('GET', `/api/admin/inventory/movements?product_id=${product.id}`, null, (await req('POST', '/api/auth/login', { email: 'admin@spiro.demo', password: 'admin123' })).json.token)).json.movements
  const e2eMovements = movements.filter((m) => m.client_txn_id && m.client_txn_id.startsWith('e2e-off-'))
  const totalMoved = e2eMovements.reduce((s, m) => s + Math.abs(m.qty), 0)
  check(`movement ledger has exactly ${qtyPushed} deducted units for e2e sales`, totalMoved === qtyPushed, `(got ${totalMoved})`)
  check('each e2e sale has one movement per product line', e2eMovements.length === 3, `(got ${e2eMovements.length})`)

  console.log(`\n========== RESULT: ${pass} passed, ${fail} failed ==========\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Offline lifecycle test crashed:', err)
  process.exit(1)
})
