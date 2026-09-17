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
 * An operator already on the team must be able to be granted (and stripped of)
 * POS inventory entry by an admin — no new activation code, no re-login.
 */
async function main() {
  pool.options.connectionTimeoutMillis = 5000;

  const fixtures = await commit(async (db) => {
    const mk = async (role) => (await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1, $2, 'x', $3, '[]') RETURNING *`,
      [`${role} test`, `${role}-${randomUUID()}@example.com`, role]
    )).rows[0];
    return { admin: await mk('admin'), cashier: await mk('cashier') };
  });

  let current = signToken(fixtures.admin);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${current}`;
    return require('../src/middleware/auth').requireAuth(req, res, next);
  });
  app.use('/api/admin', require('../src/routes/admin'));
  app.use('/api/purchasing', require('../src/routes/purchasing'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, body) => {
    const res = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(7000),
    });
    return { status: res.status, body: await res.json() };
  };
  const catalogAs = async (token) => {
    current = token;
    const r = await request('GET', '/api/purchasing/catalog');
    assert.equal(r.status, 200);
    return r.body.can_receive;
  };

  const cashierToken = signToken({ ...fixtures.cashier, permissions: [] });
  const adminToken = signToken({ ...fixtures.admin, permissions: [] });

  try {
    assert.equal(await catalogAs(cashierToken), false, 'a fresh cashier cannot receive stock');

    current = adminToken;
    const grant = await request('PATCH', `/api/admin/users/${fixtures.cashier.id}`, {
      permissions: ['inventory_entry', 'not_a_real_permission'],
    });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.deepEqual(grant.body.user.permissions, ['inventory_entry'], 'unknown capabilities are dropped by the whitelist');

    assert.equal(await catalogAs(cashierToken), true, 'the grant applies without a new token');

    current = adminToken;
    const revoke = await request('PATCH', `/api/admin/users/${fixtures.cashier.id}`, { permissions: [] });
    assert.equal(revoke.status, 200);
    assert.deepEqual(revoke.body.user.permissions, []);
    assert.equal(await catalogAs(cashierToken), false, 'the revoke applies without a new token');

    current = adminToken;
    const bad = await request('PATCH', `/api/admin/users/${fixtures.cashier.id}`, { permissions: 'inventory_entry' });
    assert.equal(bad.status, 400, 'a non-list permissions value is rejected');

    current = cashierToken;
    const forbidden = await request('PATCH', `/api/admin/users/${fixtures.admin.id}`, { permissions: ['inventory_entry'] });
    assert.equal(forbidden.status, 403, 'only admins may change capabilities');

    const stillEmpty = await pool.query('SELECT permissions FROM users WHERE id=$1', [fixtures.admin.id]);
    assert.deepEqual(stillEmpty.rows[0].permissions, []);
    console.log('PASS: admins grant and revoke POS inventory entry for existing users');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await commit(async (db) => {
      for (const id of [fixtures.admin.id, fixtures.cashier.id]) {
        await db.query('DELETE FROM audit_log WHERE user_id=$1::uuid OR entity_id=$1::text', [id]);
        await db.query('DELETE FROM users WHERE id=$1', [id]);
      }
    });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
