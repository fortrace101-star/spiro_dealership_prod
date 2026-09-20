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

module.exports = { notifyAdmins, saleNotification, stockWarning, revenueRecord, ensureConfigured };
