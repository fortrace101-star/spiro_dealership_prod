const { pool } = require('c:/Users/manue/Desktop/spiro/server/src/db');
pool.query(`SELECT role, count(*)::int AS n FROM users WHERE is_active GROUP BY role`)
  .then(async (r) => {
    console.table(r.rows);
    const n = await pool.query(`SELECT kind, count(*)::int AS n FROM notifications GROUP BY kind ORDER BY n DESC`);
    console.table(n.rows);
    process.exit(0);
  })
  .catch((e) => { console.error(e.message); process.exit(1) });
