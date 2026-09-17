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
 * Reorder lists are prepared by the floor (POS) or the office (admin/manager).
 * They must never touch stock — only a received consignment may do that.
 */
async function main() {
  pool.options.connectionTimeoutMillis = 5000;

  const actor = await commit(async (db) => {
    const user = (await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ('Reorder test', $1, 'x', 'manager', '[]') RETURNING *`,
      [`reorder-${randomUUID()}@example.com`]
    )).rows[0];
    const product = (await db.query(
      `INSERT INTO products (sku, name, category, cost_price, selling_price, stock_qty, reorder_level)
       VALUES ($1, 'Chain lube', 'Consumable', 40, 70, 3, 12) RETURNING *`,
      [`REORDER-${randomUUID()}`]
    )).rows[0];
    return { user, product };
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
    const catalog = await request('GET', '/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.can_receive, true, 'managers hold receiving rights');

    const before = (await pool.query('SELECT stock_qty FROM products WHERE id=$1', [actor.product.id])).rows[0].stock_qty;

    const txn = randomUUID();
    const body = {
      client_txn_id: txn,
      title: 'Reorder — chain lube',
      notes: 'weekly',
      items: [{ product_id: actor.product.id, qty: 24 }],
    };
    const created = await request('POST', '/reorders', body);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.record.title, 'Reorder — chain lube');
    assert.equal(created.body.record.items.length, 1);
    assert.equal(created.body.record.items[0].qty, 24);
    assert.equal(created.body.record.items[0].sku, actor.product.sku);

    const after = (await pool.query('SELECT stock_qty FROM products WHERE id=$1', [actor.product.id])).rows[0].stock_qty;
    assert.equal(after, before, 'reorder lists must not change stock');
    const movements = (await pool.query('SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1', [actor.product.id])).rows[0].n;
    assert.equal(movements, 0, 'reorder lists must not write stock movements');

    const retry = await request('POST', '/reorders', body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    const rows = (await pool.query('SELECT count(*)::int AS n FROM reorder_lists WHERE created_by=$1', [actor.user.id])).rows[0].n;
    assert.equal(rows, 1, 'duplicate submit must not create a second list');

    const listed = await request('GET', '/reorders');
    assert.equal(listed.status, 200);
    const mine = listed.body.records.find((r) => r.id === created.body.record.id);
    assert.ok(mine, 'the created list must be visible to the office');
    assert.equal(mine.created_by_name, 'Reorder test');
    console.log('PASS: reorder lists save once, stay visible and never touch stock');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await commit(async (db) => {
      await db.query('DELETE FROM stock_movements WHERE product_id=$1', [actor.product.id]);
      await db.query('DELETE FROM consignments WHERE created_by=$1', [actor.user.id]);
      await db.query('DELETE FROM reorder_lists WHERE created_by=$1', [actor.user.id]);
      await db.query('DELETE FROM audit_log WHERE user_id=$1', [actor.user.id]);
      await db.query('DELETE FROM products WHERE id=$1', [actor.product.id]);
      await db.query('DELETE FROM users WHERE id=$1', [actor.user.id]);
    });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());