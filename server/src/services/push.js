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

/** Fan a payload out to an explicit set of push subscriptions. */
async function sendToSubs(subs, payload) {
  const data = JSON.stringify(payload);
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

/** Send payload to every push subscription of admins (and optionally managers). */
async function notifyAdmins(payload) {
  if (!ensureConfigured()) return;
  const subs = await many(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE u.is_active AND u.role IN ('admin','manager')`
  );
  await sendToSubs(subs, payload);
}

/** Send payload to a single user's subscriptions — POS operator alerts (credit decisions). */
async function notifyUser(userId, payload) {
  if (!ensureConfigured() || !userId) return;
  const subs = await many(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  await sendToSubs(subs, payload);
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

/** Payload when revenue sets a new all-time high for a period ('week' | 'month'). */
function revenueRecord(newRevenue, prevRevenue, date, period = 'day') {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const label = period === 'month' ? 'month' : period === 'day' ? 'day' : 'week';
  return {
    title: '📈 Revenue record',
    body: `New all-time ${label} high: UGX ${fmt(newRevenue)} (${date}; previous UGX ${fmt(prevRevenue)})`,
    url: '/reports',
    tag: `revenue-record:${period}:${date}`,
    revenue: Number(newRevenue || 0),
    previous: Number(prevRevenue || 0),
    date,
    period,
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

/** Payload for a credit-sale approval decision → pushed to the sale's cashier
 *  (the POS bell): approved = open the pending list and Finalize; rejected =
 *  do not release the goods. */
function creditDecision(decision, sale) {
  const amount = Number(sale.total || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const approved = decision === 'approved';
  return {
    title: approved ? '✅ Credit sale approved' : '❌ Credit sale rejected',
    body: approved
      ? `${sale.receipt_no} — UGX ${amount} — Finalize to complete the sale`
      : `${sale.receipt_no} — UGX ${amount} — do not release the goods`,
    url: '/',
    tag: 'credit:' + (sale.id || sale.receipt_no || ''),
    saleId: sale.id,
    receiptNo: sale.receipt_no,
    decision,
    creditEvent: true,
  };
}

/** Payload when a customer pays down a credit debt — revenue recognized now. */
function creditPayment(sale, amount, balance) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  return {
    title: '💰 Credit payment received',
    body: `${sale.receipt_no} — UGX ${fmt(amount)} received · UGX ${fmt(balance)} still outstanding`,
    url: '/credit',
    tag: 'credit-pay:' + (sale.id || ''),
    saleId: sale.id,
    receiptNo: sale.receipt_no,
    amount: Number(amount || 0),
    balance: Number(balance || 0),
  };
}

module.exports = { notifyAdmins, notifyUser, saleNotification, stockWarning, revenueRecord, restockNotification, creditDecision, creditPayment, ensureConfigured };
