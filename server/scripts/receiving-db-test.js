const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
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

async function main() {
  pool.options.connectionTimeoutMillis = 5000;
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await commit((db) => db.query(schema));

  const receiver = await commit(async (db) => {
    const user = (await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ('Receiving test', $1, 'x', 'cashier', '[]') RETURNING *`,
      [`receiving-${randomUUID()}@example.com`]
    )).rows[0];
    const product = (await db.query(
      `INSERT INTO products (sku, name, category, cost_price, selling_price, stock_qty) VALUES ($1, 'Brake pads', 'Spare part', 100, 160, 4) RETURNING *`,
      [`RECEIVE-${randomUUID()}`]
    )).rows[0];
    return { user, product };
  });
  await pool.query(`UPDATE users SET permissions='[\"inventory_entry\"]' WHERE id=$1`, [receiver.user.id]);
  const token = signToken({ id: receiver.user.id, full_name: receiver.user.full_name, role: receiver.user.role, permissions: ['inventory_entry'] });

  const app = express();
  app.use(express.json());
  // Apply the same auth/user contract as the production app: token -> req.user.
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    return require('../src/middleware/auth').requireAuth(req, res, next);
  });
  app.use('/api/purchasing', require('../src/routes/purchasing'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/purchasing`;
  async function request(method, route, body) {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(7000),
    });
    return { status: res.status, body: await res.json() };
  }

  try {
    const catalog = await request('GET', '/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.can_receive, true);

    const txn = randomUUID();
    const create = await request('POST', '/consignments', {
      client_txn_id: txn,
      reference: 'GRN-1',
      supplier: 'Supplier',
      delivery_cost: 12.5,
      notes: 'test',
      items: [{ product_id: receiver.product.id, qty: 3, unit_cost: 110 }],
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    assert.equal(Number(create.body.record.items_total), 330);

    const after = await pool.query('SELECT stock_qty, cost_price FROM products WHERE id=$1', [receiver.product.id]);
    assert.equal(after.rows[0].stock_qty, 7);
    assert.equal(Number(after.rows[0].cost_price), 110);
    const movements = await pool.query('SELECT qty, type, client_txn_id FROM stock_movements WHERE product_id=$1 ORDER BY created_at DESC LIMIT 1', [receiver.product.id]);
    assert.deepEqual([movements.rows[0].qty, movements.rows[0].type, movements.rows[0].client_txn_id], [3, 'purchase', txn]);

    const retry = await request('POST', '/consignments', {
      client_txn_id: txn,
      reference: 'GRN-1',
      supplier: 'Supplier',
      delivery_cost: 12.5,
      notes: 'test',
      items: [{ product_id: receiver.product.id, qty: 3, unit_cost: 110 }],
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    const unchanged = await pool.query('SELECT stock_qty FROM products WHERE id=$1', [receiver.product.id]);
    assert.equal(unchanged.rows[0].stock_qty, 7);

    const bad = await request('POST', '/consignments', {
      client_txn_id: randomUUID(),
      reference: 'GRN-ROLLBACK',
      supplier: 'Supplier',
      delivery_cost: 0,
      items: [{ product_id: receiver.product.id, qty: 2, unit_cost: 5 }, { product_id: randomUUID(), qty: 1, unit_cost: 1 }],
    });
    assert.equal(bad.status, 404);
    const rolledBack = await pool.query('SELECT stock_qty FROM products WHERE id=$1', [receiver.product.id]);
    assert.equal(rolledBack.rows[0].stock_qty, 7);
    const missing = await pool.query(`SELECT count(*)::int AS n FROM consignments WHERE reference='GRN-ROLLBACK'`);
    assert.equal(missing.rows[0].n, 0);
    console.log('PASS: receiving applies stock once and rolls back failures');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await commit(async (db) => {
      await db.query('DELETE FROM stock_movements WHERE product_id=$1', [receiver.product.id]);
      await db.query('DELETE FROM consignments WHERE created_by=$1', [receiver.user.id]);
      await db.query('DELETE FROM reorder_lists WHERE created_by=$1', [receiver.user.id]);
      await db.query('DELETE FROM audit_log WHERE user_id=$1', [receiver.user.id]);
      await db.query('DELETE FROM products WHERE id=$1', [receiver.product.id]);
      await db.query('DELETE FROM users WHERE id=$1', [receiver.user.id]);
    });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
