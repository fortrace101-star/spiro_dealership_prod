/* Real PostgreSQL activation regression. All writes are rolled back. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { pool } = require('../src/db');

async function main() {
  pool.options.connectionTimeoutMillis = 5000;
  const client = await pool.connect();
  const originalQuery = pool.query;
  let server;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    // Route DB helpers and audit writes all use this rollback-only connection.
    pool.query = client.query.bind(client);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../src/routes/auth'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    async function request(route, body, token) {
      const res = await fetch(base + route, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(7000),
      });
      return { status: res.status, body: await res.json() };
    }
    for (const permissions of [[], ['inventory_entry']]) {
      const id = randomUUID();
      const email = `activation-${id}@example.com`;
      const code = `TEST-${id}`;
      const password = randomUUID();
      await client.query(
        `INSERT INTO activation_codes (code, role, permissions) VALUES ($1, 'cashier', $2)`,
        [code, JSON.stringify(permissions)]
      );
      const registration = await request('/register', {
        code, full_name: 'Rollback-only activation test', email, password, device_id: 'TEST',
      });
      assert.equal(registration.status, 201, JSON.stringify(registration.body));
      assert.equal(registration.body.user.email, email);
      assert.deepEqual(registration.body.user.permissions, permissions);
      const stored = await client.query('SELECT id, email, permissions FROM users WHERE email = $1', [email]);
      assert.equal(stored.rowCount, 1);
      assert.deepEqual(stored.rows[0].permissions, permissions);
      const claimed = await client.query('SELECT claimed_by, used_at FROM activation_codes WHERE code = $1', [code]);
      assert.equal(claimed.rows[0].claimed_by, stored.rows[0].id);
      assert.ok(claimed.rows[0].used_at);
      const login = await request('/login', { email, password });
      assert.equal(login.status, 200);
      const me = await request('/me', null, login.body.token);
      assert.equal(me.status, 200);
      assert.deepEqual(me.body.user.permissions, permissions);
      console.log(`PASS: PostgreSQL activation, saved email, login and session permissions ${JSON.stringify(permissions)}`);
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    pool.query = originalQuery;
    try {
      await client.query('ROLLBACK');
      console.log('Rolled back all test accounts, codes and audit entries.');
    } finally {
      client.release();
    }
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => pool.end());
