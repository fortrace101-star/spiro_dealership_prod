const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('../config'); // ensure dotenv is loaded before Pool reads DATABASE_URL

/**
 * Managed Postgres (Render, Neon, Supabase, ...) refuses non-TLS connections
 * and answers with a bare `read ECONNRESET`, which is easy to misread as a
 * network/firewall problem. Local Postgres usually has no TLS at all.
 *
 * So: if DATABASE_URL targets something other than localhost and carries no
 * explicit sslmode, force SSL on. An explicit `sslmode=` in the URL (or
 * DATABASE_SSL env) always wins, so you can still override either way.
 */
function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL || '';
  const envSSL = String(process.env.DATABASE_SSL || '').toLowerCase();

  if (envSSL === 'disable' || envSSL === 'false') return { connectionString };
  if (envSSL === 'require' || envSSL === 'true') {
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }

  if (/sslmode=/i.test(connectionString)) return { connectionString };

  let host = '';
  try { host = new URL(connectionString).hostname; } catch { /* parsed by pg later */ }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (isLocal) return { connectionString };

  return { connectionString, ssl: { rejectUnauthorized: false } };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => console.error('[db] idle client error', err.message));

async function query(text, params = []) {
  return pool.query(text, params);
}

async function one(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

async function many(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function initSchema() {
  // Strip any UTF-8 BOM so a byte-order mark at the start of schema.sql can
  // never be sent to Postgres as a syntax error ("syntax error at or near ...").
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/^\uFEFF/, '');
  await pool.query(sql);
  console.log('[db] schema ready');
}


module.exports = { pool, query, one, many, initSchema };
