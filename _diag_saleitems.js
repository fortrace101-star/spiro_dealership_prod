process.env.NODE_PATH = 'c:/Users/manue/Desktop/spiro/server/node_modules';
require('module').Module._initPaths();
process.chdir('c:/Users/manue/Desktop/spiro/server');
const { Pool } = require('pg');
require('dotenv').config();
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const items = await p.query(
    `SELECT s.receipt_no, s.created_at, si.name, si.kind, si.qty, si.product_id, si.bike_id
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      ORDER BY s.created_at DESC LIMIT 15`
  );
  console.log('sale_items=' + JSON.stringify(items.rows));
  const chg = await p.query(
    `SELECT sm.note, sm.qty, sm.created_at, pr.name, pr.stock_qty, pr.reorder_level
       FROM stock_movements sm LEFT JOIN products pr ON pr.id = sm.product_id
      WHERE pr.sku = 'CHR-360' OR sm.note LIKE '%CHR-360%'
      ORDER BY sm.created_at DESC LIMIT 8`
  );
  console.log('charger_moves=' + JSON.stringify(chg.rows));
  await p.end();
})().catch((e) => console.log('DB_FAIL ' + e.message));
