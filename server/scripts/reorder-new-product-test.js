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
 * Reorder lists may include planned products that have never been stocked.
 * Saving the list must not create a catalog row or touch stock; the planned
 * product is only created when the fulfilling consignment is received.
 */
async function main() {
  pool.options.connectionTimeoutMillis = 5000;
  const sku = 'NEW-' + randomUUID().slice(0, 8).toUpperCase();

  const actor = await commit(async (db) => {
    const user = (await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ('Reorder new-product test', $1, 'x', 'manager', '[]') RETURNING *`,
      [`reorder-new-${randomUUID()}@example.com`]
    )).rows[0];
    return { user };
  });
  const token = signToken({ id: actor.user.id, full_name: actor.user.full_name, role: actor.user.role, permissions: [] });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    return require('../src/middleware/auth').requireAuth(req, res, next);
  });
  app.use('/api/purchasing', require('../src/routes/purchasing'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/purchasing`;
  const request = async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(7000),
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    // 1. Save a reorder list containing a planned (never stocked) product.
    const listBody = {
      client_txn_id: randomUUID(),
      title: 'Reorder — planned brake pad',
      notes: '',
      items: [{
        product_id: null, sku, name: 'Planned brake pad', qty: 10, unit_cost: 15000, reorder_level: 10,
        new_product: { sku, name: 'Planned brake pad', barcode: '', category: 'Spare Parts', selling_price: 0, min_stock: 5, reorder_level: 10 },
      }],
    };
    const created = await request('POST', '/reorders', listBody);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const list = created.body.record;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].product_id, null, 'saving the list must not create a catalog row yet');
    assert.equal(list.items[0].unit_cost, 15000, 'the planned unit cost is stored for the estimate');
    assert.equal(list.items[0].new_product.sku, sku);
    const absent = (await pool.query('SELECT count(*)::int AS n FROM products WHERE sku=$1', [sku])).rows[0].n;
    assert.equal(absent, 0, 'saving the list must not create the product');

    // 2. Receive a consignment fulfilling that list.
    const txBody = {
      client_txn_id: randomUUID(),
      reference: 'GRN-' + randomUUID().slice(0, 8).toUpperCase(),
      supplier: 'Test supplier',
      delivery_cost: 0,
      notes: '',
      source_reorder_id: list.id,
      items: [{
        product_id: null, qty: 10, unit_cost: 15000,
        new_product: { sku, name: 'Planned brake pad', barcode: '', category: 'Spare Parts', selling_price: 25000, min_stock: 5, reorder_level: 10 },
      }],
    };
    const received = await request('POST', '/consignments', txBody);
    assert.equal(received.status, 201, JSON.stringify(received.body));
    const product = (await pool.query('SELECT * FROM products WHERE sku=$1', [sku])).rows[0];
    assert.ok(product, 'receiving must create the planned product');
    assert.equal(product.stock_qty, 10);
    assert.equal(Number(product.cost_price), 15000);
    assert.equal(Number(product.selling_price), 25000);
    const movements = (await pool.query('SELECT qty FROM stock_movements WHERE product_id=$1 AND type=$2', [product.id, 'purchase'])).rows;
    assert.equal(movements.length, 1);
    assert.equal(movements[0].qty, 10);
    const fulfilled = (await pool.query('SELECT fulfilled FROM reorder_lists WHERE id=$1', [list.id])).rows[0];
    assert.equal(fulfilled.fulfilled, true, 'the source list must be marked fulfilled');
    console.log('PASS: planned new products save on reorder lists and are only created on receipt');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await commit(async (db) => {
      await db.query('DELETE FROM stock_movements WHERE product_id IN (SELECT id FROM products WHERE sku=$1)', [sku]);
      await db.query('DELETE FROM consignments WHERE created_by=$1', [actor.user.id]);
      await db.query('DELETE FROM reorder_lists WHERE created_by=$1', [actor.user.id]);
      await db.query('DELETE FROM audit_log WHERE user_id=$1', [actor.user.id]);
      await db.query('DELETE FROM products WHERE sku=$1', [sku]);
      await db.query('DELETE FROM users WHERE id=$1', [actor.user.id]);
    });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());