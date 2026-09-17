/* Isolated HTTP regression checks: real auth router/bcrypt/JWT, in-memory DB. */
const assert = require('node:assert/strict');
const express = require('express');

const users = [];
const codes = new Map([
  ['EMAIL-TEST', { id: 'code-1', code: 'EMAIL-TEST', role: 'cashier', permissions: [] }],
  ['EMAIL-NEXT', { id: 'code-2', code: 'EMAIL-NEXT', role: 'manager', permissions: [] }],
]);
let queries = 0;
async function one(sql, params = []) {
  queries++;
  if (sql.includes('SELECT * FROM activation_codes')) {
    const code = codes.get(params[0].toUpperCase());
    return code && !code.used_at ? code : null;
  }
  if (sql.includes('FROM users WHERE lower(email)')) {
    return users.find((u) => u.email.toLowerCase() === params[0].toLowerCase()) || null;
  }
  if (sql.includes('INSERT INTO users')) {
    const [full_name, email, phone, password_hash, role, encodedPermissions] = params;
    assert.equal(typeof encodedPermissions, 'string', 'JSONB permissions must be JSON serialized');
    const permissions = JSON.parse(encodedPermissions);
    assert.ok(Array.isArray(permissions));
    const user = { id: `user-${users.length + 1}`, full_name, email, phone, password_hash, role, permissions, is_active: true };
    users.push(user);
    return user;
  }
  if (sql.includes('UPDATE activation_codes')) {
    const code = [...codes.values()].find((c) => c.id === params[1]);
    code.used_at = new Date();
    code.claimed_by = params[0];
    return null;
  }
  if (sql.includes('UPDATE users SET last_login_at') || sql.includes('INSERT INTO audit_log')) return null;
  throw new Error(`Unexpected test query: ${sql}`);
}

// Install doubles before importing the router; never connect to the real database.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { one, many: async () => users } };
const configPath = require.resolve('../src/config');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { jwtSecret: 'activation-test-only-secret' } };
const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/routes/auth'));

async function main() {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    async function post(route, body) {
      const res = await fetch(base + route, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      return { status: res.status, body: await res.json() };
    }
    const details = { code: 'EMAIL-TEST', full_name: 'Email Tester', password: 'test-password-123', device_id: 'TEST' };
    for (const email of [undefined, '', '   ', null, 123, {}, 'not-an-email', 'a@@example.com', 'a b@example.com']) {
      const before = queries;
      const r = await post('/register', { ...details, email });
      assert.equal(r.status, 400);
      assert.equal(queries, before, 'Invalid email must be rejected before DB access');
    }
    console.log('PASS: missing and invalid emails rejected');

    const created = await post('/register', { ...details, email: '  Operator@Example.com  ' });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, 'operator@example.com');
    assert.equal(users[0].email, 'operator@example.com');
    assert.equal(codes.get('EMAIL-TEST').claimed_by, users[0].id);
    assert.ok(created.body.token);
    assert.notEqual(users[0].password_hash, details.password);
    console.log('PASS: normalized email saved and activation completed');

    const duplicate = await post('/register', { ...details, code: 'EMAIL-NEXT', email: 'OPERATOR@example.com' });
    assert.equal(duplicate.status, 409);
    assert.equal(users.length, 1);
    assert.equal(codes.get('EMAIL-NEXT').used_at, undefined);
    console.log('PASS: duplicate email rejected without consuming code');

    const login = await post('/login', { email: 'OPERATOR@EXAMPLE.COM', password: details.password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'operator@example.com');
    assert.ok(login.body.token);
    const wrong = await post('/login', { email: 'operator@example.com', password: 'incorrect-password' });
    assert.equal(wrong.status, 401);
    console.log('PASS: activated user can sign in; wrong password rejected');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
