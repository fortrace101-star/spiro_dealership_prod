const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { pool } = require('../src/db');
const { signToken } = require('../src/auth');

async function commit(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already failed */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A POS terminal can hold catalog references the server no longer knows (data
 * reset, product deleted, part created while offline). A completed sale must
 * still sync — the money is real — so unknown references are stored as NULL
 * instead of failing the foreign key on every retry.
 */
async function main() {
  pool.options.connectionTimeoutMillis = 5000;

  const fx = await commit(async (db) => {
    const user = (await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ('Sync test', $1, 'x', 'cashier', '[]') RETURNING *`,
      [`sync-${randomUUID()}@example.com`]
    )).rows[0];
    const product = (await db.query(
      `INSERT INTO products (sku, name, category, cost_price, selling_price, stock_qty) VALUES ($1, 'Known part', 'Spare part', 100, 200, 10) RETURNING *`,
      [`SYNC-${randomUUID()}`]
    )).rows[0];
    const bike = (await db.query(
      `INSERT INTO bikes (vin, model, cost_price, selling_price, status) VALUES ($1, 'Known bike', 1000, 2000, 'in_stock') RETURNING *`,
      [`VIN${randomUUID().slice(0, 12)}`]
    )).rows[0];
    return { user, product, bike };
  });
  const token = signToken({ ...fx.user, permissions: [] });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    return require('../src/middleware/auth').requireAuth(req, res, next);
  });
  app.use('/api/sync', require('../src/routes/sync'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const push = async (sales) => {
    const res = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sales }),
      signal: AbortSignal.timeout(7000),
    });
    return { status: res.status, body: await res.json() };
  };

  const txn = randomUUID();
  const sale = {
    client_txn_id: txn,
    device_id: 'POS-TEST',
    payment_method: 'cash',
    subtotal: 650,
    discount: 0,
    total: 650,
    cost_total: 300,
    amount_paid: 700,
    change_due: 50,
    created_at: new Date().toISOString(),
    items: [
      { product_id: fx.product.id, kind: 'part', name: 'Known part', qty: 2, unit_price: 200, unit_cost: 100, line_total: 400 },
      { product_id: randomUUID(), kind: 'part', name: 'Ghost part', qty: 1, unit_price: 150, unit_cost: 50, line_total: 150 },
      { product_id: null, bike_id: randomUUID(), kind: 'bike', name: 'Ghost bike', qty: 1, unit_price: 100, unit_cost: 150, line_total: 100 },
    ],
  };

  try {
    const first = await push([sale]);
    assert.equal(first.status, 200);
    assert.equal(first.body.failed.length, 0, `sale must not fail: ${JSON.stringify(first.body.failed)}`);
    assert.equal(first.body.accepted.length, 1);

    const stored = await pool.query('SELECT id FROM sales WHERE client_txn_id=$1', [txn]);
    assert.equal(stored.rows.length, 1, 'the sale is recorded');
    const saleId = stored.rows[0].id;

    const items = (await pool.query('SELECT name, product_id, bike_id, qty, line_total FROM sale_items WHERE sale_id=$1 ORDER BY name', [saleId])).rows;
    assert.equal(items.length, 3, 'all three lines are kept');
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    assert.equal(byName['Known part'].product_id, fx.product.id, 'a known reference is kept');
    assert.equal(byName['Ghost part'].product_id, null, 'an unknown product reference is dropped, not fatal');
    assert.equal(byName['Ghost bike'].bike_id, null, 'an unknown bike reference is dropped, not fatal');
    assert.equal(Number(byName['Ghost part'].line_total), 150, 'the money is preserved');

    const stock = (await pool.query('SELECT stock_qty FROM products WHERE id=$1', [fx.product.id])).rows[0].stock_qty;
    assert.equal(stock, 8, 'stock is deducted only for the known product');
    const bikeStatus = (await pool.query('SELECT status FROM bikes WHERE id=$1', [fx.bike.id])).rows[0].status;
    assert.equal(bikeStatus, 'in_stock', 'an unrelated bike is untouched');

    const again = await push([sale]);
    assert.equal(again.body.duplicates.length, 1, 'replaying the same sale is idempotent');
    const stockAfter = (await pool.query('SELECT stock_qty FROM products WHERE id=$1', [fx.product.id])).rows[0].stock_qty;
    assert.equal(stockAfter, 8, 'the retry does not deduct stock twice');

    const junk = await push([{ ...sale, client_txn_id: randomUUID(), items: [{ product_id: 'not-a-uuid', kind: 'part', name: 'Junk ref', qty: 1, unit_price: 10, unit_cost: 1, line_total: 10 }] }]);
    assert.equal(junk.body.failed.length, 0, 'a malformed reference cannot block the sale');
    console.log('PASS: sales with unknown catalog references still sync, money preserved');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await commit(async (db) => {
      await db.query('DELETE FROM stock_movements WHERE user_id=$1::uuid', [fx.user.id]);
      await db.query('DELETE FROM approvals WHERE requested_by=$1::uuid', [fx.user.id]);
      await db.query('DELETE FROM sales WHERE cashier_id=$1::uuid', [fx.user.id]);
      await db.query('DELETE FROM audit_log WHERE user_id=$1::uuid OR entity_id=$1::text', [fx.user.id]);
      await db.query('DELETE FROM bikes WHERE id=$1', [fx.bike.id]);
      await db.query('DELETE FROM products WHERE id=$1', [fx.product.id]);
      await db.query('DELETE FROM users WHERE id=$1', [fx.user.id]);
    });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
