process.env.NODE_PATH = 'c:/Users/manue/Desktop/spiro/server/node_modules';
require('module').Module._initPaths();
process.chdir('c:/Users/manue/Desktop/spiro/server');
const { Pool } = require('pg');
require('dotenv').config();
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const s = await p.query('SELECT receipt_no,total,payment_method,created_at FROM sales ORDER BY created_at DESC LIMIT 5');
  console.log('recent_sales=' + JSON.stringify(s.rows));
  const l = await p.query('SELECT name,sku,stock_qty,reorder_level FROM products WHERE stock_qty<=reorder_level ORDER BY stock_qty LIMIT 10');
  console.log('lowstock=' + JSON.stringify(l.rows));
  await p.end();
})().catch((e) => console.log('DB_FAIL ' + e.message));
