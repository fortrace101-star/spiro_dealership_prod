const webpush = require('web-push');
const { many } = require('../db');
const { vapid } = require('../config');

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!vapid.publicKey || !vapid.privateKey) {
    console.warn('[push] VAPID keys missing — notifications disabled. Run: npm run vapid');
    return false;
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  configured = true;
  return true;
}

/** Send payload to every push subscription of admins (and optionally managers). */
async function notifyAdmins(payload) {
  if (!ensureConfigured()) return;
  const data = JSON.stringify(payload);

  const subs = await many(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE u.is_active AND u.role IN ('admin','manager')`
  );

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data,
          { TTL: 3600 }
        );
      } catch (err) {
        // 404/410 = subscription expired → remove it
        if (err.statusCode === 404 || err.statusCode === 410) {
          await many(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
        } else {
          console.error('[push] send failed:', err.statusCode || err.message);
        }
      }
    })
  );
}

function saleNotification(sale) {
  const amount = Number(sale.total || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  return {
    title: '🛵 New Sale',
    body: `${sale.receipt_no || sale.client_txn_id} — UGX ${amount} (${sale.payment_method})`,
    url: '/sales',
    tag: sale.client_txn_id,
    receiptNo: sale.receipt_no,
    total: sale.total,
    paymentMethod: sale.payment_method,
    cashier: sale.cashier_name,
  };
}

/** Payload when a product's stock has fallen to/below its reorder level after a sale.
 *  Returns null while stock is still healthy, so the caller can simply skip sending. */
function stockWarning(product, qty, context) {
  const stock = Number(qty || 0);
  const level = Number(product.reorder_level || 0);
  if (stock > level) return null;
  return {
    title: stock <= 0 ? '🚨 Stock out' : '⚠️ Low stock',
    body: `${product.name} (${product.sku}) — ${stock} left (reorder level ${level}) — ${context}`,
    url: '/inventory',
    tag: 'low-stock:' + product.id,
    productId: product.id,
    stockQty: stock,
    reorderLevel: level,
    context,
  };
}

/** Payload when today's revenue sets a new all-time high. */
function revenueRecord(newRevenue, prevRevenue, date) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  return {
    title: '📈 Revenue record',
    body: `New all-time high: UGX ${fmt(newRevenue)} on ${date} (previous UGX ${fmt(prevRevenue)})`,
    url: '/reports',
    tag: 'revenue-record:' + date,
    revenue: Number(newRevenue || 0),
    previous: Number(prevRevenue || 0),
    date,
  };
}

/** Payload when a consignment fulfills a reorder list (stock received / restocked). */
function restockNotification(record) {
  const itemCount = (record.items || []).length;
  const label = record.reference || record.title || 'Restock';
  return {
    title: '📦 Stock received',
    body: `${label} — ${itemCount} line${itemCount === 1 ? '' : 's'} received${record.supplier ? ' from ' + record.supplier : ''}`,
    url: '/purchasing',
    tag: 'restock:' + record.id,
    recordId: record.id,
    itemCount,
    supplier: record.supplier || null,
  };
}

module.exports = { notifyAdmins, saleNotification, stockWarning, revenueRecord, restockNotification, ensureConfigured };
