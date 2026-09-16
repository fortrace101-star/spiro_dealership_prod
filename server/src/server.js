const { app, initSchema } = require('./app');
const config = require('./config');
const { initSchema: init } = require('./db');

(async () => {
  try {
    await init();
  } catch (err) {
    console.error('[server] schema init failed:', err.message);
    console.error('Is PostgreSQL running and DATABASE_URL correct?');
  }
  app.listen(config.port, () => {
    console.log(`[server] Spiro API listening on http://localhost:${config.port}`);
  });
})();
