/**
 * Wipe every row from a database while keeping all structure.
 *
 * First half of the production bootstrap. schema.sql is pure CREATE IF NOT
 * EXISTS, so after this runs the server re-creates an empty schema on next
 * boot and the install looks brand new — which flips the app into
 * first-launch setup (no admin => /api/setup/status says setup_required).
 *
 * Usage:
 *   npm run db:wipe            dry run: prints the target and the plan
 *   npm run db:wipe:yes        actually truncates
 *   node src/scripts/db-wipe.js --yes        (same thing, bypasses npm)
 *   SPIRO_WIPE=yes npm run db:wipe           (env var form)
 *
 * IMPORTANT: npm 11 strips every --flag you type after `--`, so
 * `npm run db:wipe -- --yes` reaches this script WITHOUT --yes and stays a
 * dry run. That is why confirmation is also accepted as a bare `yes` and as
 * the SPIRO_WIPE environment variable.
 */
require('dotenv').config();
const { pool, one, many } = require('../db');

function confirmed() {
  const argv = process.argv.slice(2);
  if (argv.includes('--yes') || argv.includes('-y') || argv.includes('yes')) return true;
  return /^(1|yes|true)$/i.test(String(process.env.SPIRO_WIPE || ''));
}

async function main() {
  const target = await one(
    `SELECT current_database() AS db, current_user AS usr,
            COALESCE(inet_server_addr()::text, 'local socket') AS host,
            COALESCE(inet_server_port()::text, '-') AS port`
  );
  console.log('Target database');
  console.log(`  name : ${target.db}`);
  console.log(`  user : ${target.usr}`);
  console.log(`  host : ${target.host}:${target.port}`);

  const tables = await many(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  if (!tables.length) {
    console.log('\nNothing to wipe — this database has no tables.');
    await pool.end();
    return;
  }

  const names = tables.map((t) => t.tablename);
  console.log(`\n${names.length} tables would be truncated:`);
  console.log(`  ${names.join(', ')}`);

  const isConfirmed = confirmed();
  // Safety valve: lets you prove the confirmation was actually received
  // (e.g. `SPIRO_DRY_RUN=1 npm run db:wipe:yes`) without truncating anything.
  const forceDryRun = /^(1|yes|true)$/i.test(String(process.env.SPIRO_DRY_RUN || ''));

  if (!isConfirmed || forceDryRun) {
    if (isConfirmed) {
      console.log('\nConfirmation RECEIVED (--yes / SPIRO_WIPE is working), but SPIRO_DRY_RUN=1 forced a dry run.');
    }
    console.log('\nDRY RUN — nothing was changed. Check the target above, then re-run:');
    console.log('  npm run db:wipe:yes');
    console.log('  (npm 11 strips `-- --yes`, so the confirmation is a separate script.');
    console.log('   Also accepted: `node src/scripts/db-wipe.js --yes` or `SPIRO_WIPE=yes npm run db:wipe`)');
    await pool.end();
    process.exit(1);
  }

  const list = names.map((n) => `"${n}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  console.log('\nDone — all rows removed, table structure kept.');
  console.log(`  "${target.db}" now has no users, products, or sales.`);
  console.log('  Next: restart the server (re-applies schema), then generate a setup code.');
  await pool.end();
}

main().catch((err) => {
  console.error('Wipe failed:', err.message);
  process.exit(1);
});
