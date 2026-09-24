/**
 * Generate the one-time code that creates the FIRST administrator on a fresh
 * install. The plaintext is printed exactly once; only its SHA-256 hash is
 * stored, so a leaked database row cannot be turned back into a usable code.
 *
 * Usage:
 *   npm run setup:code                 7 day validity (default)
 *   npm run setup:code -- 24h          24 hours (bare value — npm 11 strips
 *                                      `--flags` typed after `--`)
 *   SETUP_TTL=30m npm run setup:code   env var form
 *   node src/scripts/gen-setup-code.js --ttl 24h   bypasses npm
 */
require('dotenv').config();
const crypto = require('crypto');
const { pool, one, initSchema } = require('../db');

// No 0/O, 1/I/L — the code is read off a terminal and typed into a form.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const normalize = (code) => String(code || '').trim().toUpperCase();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function randomBlock(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

function parseTtl(argv, env) {
  // npm 11 strips `--flags` passed after `--`, so the TTL has three ways in:
  //   --ttl 24h          when run via `node` directly
  //   24h                bare positional: `npm run setup:code -- 24h`
  //   SETUP_TTL=24h      environment variable
  const flagIndex = argv.indexOf('--ttl');
  let raw = '7d';
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    raw = argv[flagIndex + 1];
  } else {
    const positional = argv.find((arg) => !String(arg).startsWith('-'));
    if (positional) raw = positional;
    else if (env) raw = env;
  }
  const match = /^(\d+)\s*([dhm])$/.exec(String(raw).trim().toLowerCase());
  if (!match) {
    console.error(`Invalid --ttl "${raw}". Use e.g. 7d, 24h, 30m.`);
    process.exit(1);
  }
  const ms = match[2] === 'd' ? 864e5 : match[2] === 'h' ? 36e5 : 6e4;
  return { label: `${match[1]}${match[2]}`, expiresAt: new Date(Date.now() + Number(match[1]) * ms) };
}

async function main() {
  // Re-applies schema.sql first, which guarantees the `created_by` nullable
  // migration has run before we insert a row created before any user exists.
  await initSchema();

  const ttl = parseTtl(process.argv.slice(2), process.env.SETUP_TTL);
  const code = `SPIRO-SETUP-${randomBlock(4)}-${randomBlock(4)}`;
  const target = await one(`SELECT current_database() AS db`);

  await one(
    `INSERT INTO admin_recovery_codes (id, code_hash, expires_at)
     VALUES (gen_random_uuid(), $1, $2)`,
    [sha256(normalize(code)), ttl.expiresAt]
  );

  const outstanding = await one(
    `SELECT count(*)::int AS n FROM admin_recovery_codes WHERE used_at IS NULL AND expires_at > now()`
  );

  console.log(`\nSetup code for database "${target.db}"\n`);
  console.log(`  ${code}\n`);
  console.log(`  Valid until : ${ttl.expiresAt.toISOString()} (${ttl.label})`);
  console.log(`  Enter it at : the admin app's Setup screen (first launch)`);
  console.log(`  Unused codes: ${outstanding.n}`);
  console.log('\n  Shown ONCE — only the hash is stored. Lost it? Run this again');
  console.log('  for a fresh code; each unused code can create one administrator.\n');

  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create setup code:', err.message);
  process.exit(1);
});
