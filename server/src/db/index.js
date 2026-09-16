const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('../config'); // ensure dotenv is loaded before Pool reads DATABASE_URL

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema ready');
}

module.exports = { pool, query, one, many, initSchema };
