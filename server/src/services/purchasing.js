const { createHash } = require('node:crypto');
const { pool } = require('../db');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function text(value, label, required = true) {
  if (typeof value !== 'string' || value.trim().length > 500 || (required && !value.trim())) fail(`${label} is required (maximum 500 characters)`);
  return value.trim();
}
function number(value, label, integer = false, minimum = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > 100000000 || (integer && !Number.isInteger(value)) || (!integer && Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)) fail(`Invalid ${label}`);
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) fail('Invalid record identifier');
  return value;
}
async function save(kind, input, user, db = pool) {
  const receiving = kind === 'consignments';
  if (!receiving && kind !== 'reorder_lists') fail('Invalid operation');

  // Identify the idempotency key before hashing the request deterministically.
  uuid(input.client_txn_id);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Add between 1 and 100 items');

  const title = text(receiving ? input.reference : input.title, receiving ? 'Reference' : 'Title');
  const notes = text(input.notes || '', 'Notes', false);
  const supplier = receiving ? text(input.supplier, 'Supplier') : null;
  const delivery = receiving ? number(input.delivery_cost, 'delivery cost') : 0;
  const canonical = {
    client_txn_id: input.client_txn_id,
    title,
    supplier,
    delivery_cost: delivery,
    notes,
    items: input.items,
  };
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.client_txn_id]);
    const previous = (await client.query(`SELECT * FROM ${kind} WHERE client_txn_id=$1`, [input.client_txn_id])).rows[0];
    if (previous) {
      if (previous.created_by !== user.id || previous.request_hash !== hash) fail('Submission identifier already used. Close and start a new form.', 409);
      await client.query('COMMIT');
      return { record: previous, duplicate: true };
    }
    const items = [];
    const seen = new Set();
    let cents = 0;
    for (const line of input.items) {
      if (!line || typeof line !== 'object') fail('Invalid item');
      const qty = number(line.qty, 'quantity', true, 1);
      const cost = receiving ? number(line.unit_cost, 'unit cost') : 0;
      let item;
      if (line.product_id) {
        uuid(line.product_id);
        const product = (await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE', [line.product_id])).rows[0];
        if (!product) fail('Product not found or inactive', 404);
        if (seen.has(product.id)) fail('Each product may appear only once');
        seen.add(product.id);
        const supplier = line.supplier != null ? text(line.supplier, 'supplier', false) : (product.supplier || null);
        item = { product_id: product.id, sku: product.sku, name: product.name, qty, unit_cost: receiving ? cost : Number(product.cost_price ?? 0), reorder_level: Number(product.reorder_level ?? 0), supplier };
        if (receiving) {
          cents += qty * Math.round(cost * 100);
          if (!Number.isSafeInteger(cents) || cents > 999999999999) fail('Consignment total is too large');
          await client.query('UPDATE products SET stock_qty=stock_qty+$2, cost_price=$3, updated_at=clock_timestamp() WHERE id=$1', [product.id, qty, cost]);
          await client.query(`INSERT INTO stock_movements (product_id,qty,type,user_id,client_txn_id,note) VALUES ($1,$2,'purchase',$3,$4,$5)`, [product.id, qty, user.id, input.client_txn_id, `Consignment: ${title}`]);
        }
      } else {
        if (!line.new_product) fail('Select a product');
        const p = line.new_product;
        const category = p.category || 'e-Bikes Spare Parts';
        const VALID_CATEGORIES = ['Spare Parts', 'Accessories', 'Consumables', 'e-Bikes', 'e-Bikes Spare Parts',
          // legacy values accepted for backward compatibility with offline DBs
          'e-Bike', 'e-Bike Spare Parts', 'Spare Parts', 'Spare part', 'Accessory', 'Consumable'];
        if (!VALID_CATEGORIES.includes(category)) fail('Invalid category');
        const sku = text(p.sku, 'SKU');
        const name = text(p.name, 'Name');
        const barcode = p.barcode ? text(p.barcode, 'Barcode') : null;
        const level = number(p.reorder_level ?? 10, 'reorder level', true);
        if (receiving) {
          // The stock is arriving now, so the catalog row is created immediately.
          const product = (await client.query(`INSERT INTO products (sku,name,barcode,category,supplier,cost_price,selling_price,min_stock,reorder_level)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [sku, name, barcode, category, supplier, cost,
            number(p.selling_price, 'selling price'), number(p.min_stock ?? 5, 'minimum stock', true), level])).rows[0];
          if (seen.has(product.id)) fail('Each product may appear only once');
          seen.add(product.id);
          item = { product_id: product.id, sku: product.sku, name: product.name, qty, unit_cost: cost, reorder_level: Number(product.reorder_level ?? 0) };
          cents += qty * Math.round(cost * 100);
          if (!Number.isSafeInteger(cents) || cents > 999999999999) fail('Consignment total is too large');
          await client.query('UPDATE products SET stock_qty=stock_qty+$2, cost_price=$3, updated_at=clock_timestamp() WHERE id=$1', [product.id, qty, cost]);
          await client.query(`INSERT INTO stock_movements (product_id,qty,type,user_id,client_txn_id,note) VALUES ($1,$2,'purchase',$3,$4,$5)`, [product.id, qty, user.id, input.client_txn_id, `Consignment: ${title}`]);
        } else {
          // Reorder lists are drafts and never touch stock: a planned new
          // product is carried as a payload and only becomes a catalog row
          // when a consignment fulfilling this list is received.
          if (seen.has('new:' + sku)) fail('Each product may appear only once');
          seen.add('new:' + sku);
          item = { product_id: null, sku, name, qty,
            unit_cost: line.unit_cost == null ? 0 : number(Number(line.unit_cost), 'unit cost'),
            reorder_level: level,
            new_product: { sku, name, barcode, category, selling_price: 0, min_stock: 5, reorder_level: level } };
        }
      }
      items.push(item);
    }
        // When receiving a consignment that fulfills an existing reorder list, lock
    // and validate the source list, then record the link + mark it fulfilled.
    const sourceReorderId = receiving ? (input.source_reorder_id || null) : null;
    if (sourceReorderId) {
      uuid(sourceReorderId);
      const existing = (
        await client.query('SELECT id, fulfilled FROM reorder_lists WHERE id=$1 FOR UPDATE', [sourceReorderId])
      ).rows[0];
      if (!existing) fail('Source reorder list not found', 404);
      if (existing.fulfilled) fail('This reorder list has already been fulfilled', 409);
    }
    const record = (await client.query(receiving
      ? `INSERT INTO consignments (client_txn_id,request_hash,reference,supplier,delivery_cost,items_total,items,notes,source_reorder_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`
      : `INSERT INTO reorder_lists (client_txn_id,request_hash,title,items,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, receiving
      ? [input.client_txn_id, hash, title, supplier, delivery, cents / 100, JSON.stringify(items), notes, sourceReorderId, user.id]
      : [input.client_txn_id, hash, title, JSON.stringify(items), notes, user.id])).rows[0];
    await client.query('INSERT INTO audit_log (user_id,action,entity,entity_id) VALUES ($1,$2,$3,$4)', [user.id, 'create', kind, record.id]);
    if (sourceReorderId) {
      await client.query("UPDATE reorder_lists SET fulfilled=TRUE, status='fulfilled', fulfilled_at=now(), updated_at=now() WHERE id=$1", [sourceReorderId]);
      await client.query('INSERT INTO audit_log (user_id,action,entity,entity_id) VALUES ($1,$2,$3,$4)', [user.id, 'fulfill_reorder', 'reorder_lists', sourceReorderId]);
    }
    await client.query('COMMIT');
    return { record, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') fail('SKU or barcode already exists', 409);
    throw err;
  } finally { client.release(); }
}
// Next reorder-list reference in the business format RL-19-Sep-26-01.
// The sequence is the number of lists already created today (+1) so multiple
// POS devices get an authoritative, mostly-monotonic value from the server.
async function nextReorderRef(db = pool) {
  const runner = db && db.query ? db : pool;
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const yy = String(d.getFullYear()).slice(-2);
  const count = await runner.query(
    `SELECT COUNT(*)::int AS n FROM reorder_lists WHERE created_at >= date_trunc('day', now())`,
  );
  const seq = String((count.rows[0]?.n || 0) + 1).padStart(2, '0');
  return `RL-${dd}-${mon}-${yy}-${seq}`;
}

module.exports = { save, nextReorderRef };
