const { app } = require('./app');
const config = require('./config');
const { initSchema } = require('./db');

/**
 * Initialise the schema, retrying while the database is unreachable.
 * On managed hosts (Render, Fly, Docker) the app can boot before PostgreSQL
 * accepts connections; retrying avoids a permanently un-migrated server.
 * Every request after a successful retry works without a restart, because the
 * pg pool opens connections on demand.
 */
async function initSchemaWithRetry(attempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await initSchema();
      return true;
    } catch (err) {
      const last = attempt === attempts;
      console.error(
        `[server] schema init failed (attempt ${attempt}/${attempts}): ${err.message}` +
        (last ? '' : ` — retrying in ${delayMs / 1000}s`)
      );
      if (last) {
        console.error('[server] Database still unreachable. Is PostgreSQL running and DATABASE_URL correct?');
        console.error('[server] The API is listening, but database-backed routes will return 503.');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

(async () => {
  await initSchemaWithRetry();

  app.listen(config.port, () => {
    console.log(`[server] Spiro API listening on http://localhost:${config.port}`);
  });
})();
