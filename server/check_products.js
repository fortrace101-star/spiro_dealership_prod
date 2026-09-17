const { pool } = require('./src/db');

(async () => {
  try {
    const products = await pool.query('SELECT id, sku, name, category FROM products ORDER BY updated_at DESC');
    console.log('Backend products count:', products.rows.length);
    console.log('Sample IDs:', products.rows.slice(0, 10).map(r => r.id));
    
    const bikes = await pool.query('SELECT id, frame_number, name FROM bikes');
    console.log('Backend bikes count:', bikes.rows.length);
    
    await pool.end();
  } catch (e) {
    console.error('DB error:', e.message);
  }
})();