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
      let product;
      if (line.product_id) {
        uuid(line.product_id);
        product = (await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE', [line.product_id])).rows[0];
        if (!product) fail('Product not found or inactive', 404);
      } else {
        if (!receiving || !line.new_product) fail('Select a product');
        const p = line.new_product;
        const category = p.category || 'Spare part';
        if (!['Spare part', 'Accessory', 'Consumable'].includes(category)) fail('Invalid category');
        product = (await client.query(`INSERT INTO products (sku,name,barcode,category,supplier,cost_price,selling_price,min_stock,reorder_level)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [text(p.sku, 'SKU'), text(p.name, 'Name'), p.barcode ? text(p.barcode, 'Barcode') : null, category, supplier, cost,
          number(p.selling_price, 'selling price'), number(p.min_stock ?? 5, 'minimum stock', true), number(p.reorder_level ?? 10, 'reorder level', true)])).rows[0];
      }
      if (seen.has(product.id)) fail('Each product may appear only once');
      seen.add(product.id);
      items.push({ product_id: product.id, sku: product.sku, name: product.name, qty, unit_cost: receiving ? cost : Number(product.cost_price ?? 0), reorder_level: Number(product.reorder_level ?? 0) });
      if (receiving) {
        cents += qty * Math.round(cost * 100);
        if (!Number.isSafeInteger(cents) || cents > 999999999999) fail('Consignment total is too large');
        await client.query('UPDATE products SET stock_qty=stock_qty+$2, cost_price=$3, updated_at=clock_timestamp() WHERE id=$1', [product.id, qty, cost]);
        await client.query(`INSERT INTO stock_movements (product_id,qty,type,user_id,client_txn_id,note) VALUES ($1,$2,'purchase',$3,$4,$5)`, [product.id, qty, user.id, input.client_txn_id, `Consignment: ${title}`]);
      }
    }
    const record = (await client.query(receiving
      ? `INSERT INTO consignments (client_txn_id,request_hash,reference,supplier,delivery_cost,items_total,items,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`
      : `INSERT INTO reorder_lists (client_txn_id,request_hash,title,items,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, receiving
      ? [input.client_txn_id, hash, title, supplier, delivery, cents / 100, JSON.stringify(items), notes, user.id]
      : [input.client_txn_id, hash, title, JSON.stringify(items), notes, user.id])).rows[0];
    await client.query('INSERT INTO audit_log (user_id,action,entity,entity_id) VALUES ($1,$2,$3,$4)', [user.id, 'create', kind, record.id]);
    await client.query('COMMIT');
    return { record, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') fail('SKU or barcode already exists', 409);
    throw err;
  } finally { client.release(); }
}
module.exports = { save };
