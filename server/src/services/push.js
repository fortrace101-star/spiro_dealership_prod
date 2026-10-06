const webpush = require('web-push');
const { query, many } = require('../db');
const { vapid } = require('../config');
const { emit } = require('../routes/events');

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

/** Persist the payload as one inbox row per user (durable — both apps share
 *  the same `notifications` table). The exact same object is then pushed, so
 *  the toast/OS-notification strings always match the inbox byte-for-byte.
 *  Also prunes the table: read rows after 30 days, everything after 90. */
async function persist(userIds, payload) {
  if (!userIds.length) return;
  const kind = payload.kind || 'info';
  const extra = { ...payload };
  delete extra.title; delete extra.body; delete extra.url; delete extra.tag; delete extra.kind;
  await query(
    `INSERT INTO notifications (user_id, kind, title, body, url, tag, payload)
     SELECT u.id, $2, $3, $4, $5, $6, $7 FROM users u WHERE u.id = ANY($1::uuid[])`,
    [userIds, kind, String(payload.title || 'Spiro'), String(payload.body || ''),
     payload.url || null, payload.tag || null, JSON.stringify(extra)],
  );
  // Live badge bump (Workstream D) — open clients recount without polling.
  for (const id of userIds) emit('notification.created', { userId: id, kind, title: payload.title || '' });
  await query(
    `DELETE FROM notifications
      WHERE (read_at IS NOT NULL AND read_at < now() - interval '30 days')
         OR created_at < now() - interval '90 days'`,
  );
}

/** Fan a payload out to every active admin/manager: inbox row always
 *  (durable), Web Push best-effort — missing VAPID keys or an offline
 *  device can no longer lose the event. */
async function notifyAdmins(payload) {
  try {
    const users = await many(`SELECT id FROM users WHERE is_active AND role IN ('admin','manager')`);
    if (!users.length) return;
    await persist(users.map((u) => u.id), payload);
    if (!ensureConfigured()) return;
    const subs = await many(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
         FROM push_subscriptions s
         JOIN users u ON u.id = s.user_id
        WHERE u.is_active AND u.role IN ('admin','manager')`,
    );
    await sendToSubs(subs, payload);
  } catch (err) {
    console.error('[push] notifyAdmins failed:', err.message);
  }
}

/** Same funnel for a single user — POS operator alerts (credit decisions,
 *  release decisions, permission grants) + the installment self-confirm. */
async function notifyUser(userId, payload) {
  if (!userId) return;
  try {
    await persist([userId], payload);
    if (!ensureConfigured()) return;
    const subs = await many(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    await sendToSubs(subs, payload);
  } catch (err) {
    console.error('[push] notifyUser failed:', err.message);
  }
}

function saleNotification(sale) {
  const amount = Number(sale.total || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  return {
    kind: 'sale',
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
    kind: 'stock',
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

/** Daily running-total line for the admin inbox — published on EVERY completed
 *  sale and credit settlement with the CUMULATIVE day revenue (same window as
 *  /reports/today revenue and the POS toast message2). Replaces the old
 *  all-time-high-only alert; the week/month record rows still update
 *  silently in revenue_records. The tag is unique per publish so every
 *  transaction raises its own OS notification instead of replacing one. */
function revenueRecord(dayRevenue, date) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const revenue = Number(dayRevenue || 0);
  return {
    kind: 'revenue',
    title: "📈 Today's revenue",
    body: `Running total: UGX ${fmt(revenue)} so far today (${date})`,
    url: '/reports',
    tag: `revenue:${date}:${Date.now()}`,
    revenue,
    date,
    period: 'day',
  };
}

/** Payload when a consignment fulfills a reorder list (stock received / restocked). */
function restockNotification(record) {
  const itemCount = (record.items || []).length;
  const label = record.reference || record.title || 'Restock';
  return {
    kind: 'restock',
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
    kind: 'credit_decision',
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
    kind: 'credit_payment',
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

// ---------- Cross-app workflow notifications (durable inbox + push) ----------

const fmtUgx = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });

/** A bike reservation was created — merged with its down payment (the first
 *  installment) so day-one never double-notices. Accepts the shaped service
 *  reservation ({ bike, customer }) or a raw row. */
function reservationCreated(r) {
  const paidOff = Number(r.balance) <= 0.01;
  const bike = r.bike ? `${r.bike.model} (${r.bike.vin})` : `${r.model || 'Bike'}${r.vin ? ` (${r.vin})` : ''}`;
  const who = r.customer?.full_name || r.customer_name || 'customer';
  return {
    kind: 'reservation_created',
    title: paidOff ? '🏍️ Bike sold — paid in full' : '🏍️ Bike reserved',
    body: `${bike} for ${who} — UGX ${fmtUgx(r.down_payment)} down · UGX ${fmtUgx(r.balance)} balance${paidOff ? ' · paid in full' : ''}`,
    url: '/bikes',
    tag: 'reservation:' + (r.id || ''),
    reservationId: r.id,
    downPayment: Number(r.down_payment || 0),
    balance: Number(r.balance || 0),
  };
}

/** POS asked to release a reservation — needs an admin decision. */
function releaseRequested(info) {
  return {
    kind: 'release_request',
    title: '🔓 Release requested',
    body: `${info.model || 'Bike'} (${info.vin || '—'}) — ${info.customer_name || 'no customer'} — requested by ${info.requestedBy}`,
    url: '/approvals',
    tag: 'release:' + info.reservationId,
    reservationId: info.reservationId,
    requestedBy: info.requestedBy,
  };
}

/** The admin decided a POS-raised release — travels back to the requester. */
function releaseDecision(decision, p) {
  const ok = decision === 'approved';
  return {
    kind: 'release_decision',
    title: ok ? '✅ Release approved' : '❌ Release rejected',
    body: `${p.model || 'Bike'} (${p.vin || '—'}) — ${p.customer_name || 'no customer'}${p.note ? ` — ${p.note}` : ''}`,
    url: '/',
    tag: 'release-decision:' + (p.reservation_id || ''),
    reservationId: p.reservation_id,
    decision,
  };
}

/** An installment landed — balance/progress for the admin desk. */
function installmentReceived(r, amount, balance, paidByName) {
  const completed = Number(balance) <= 0.01;
  const bike = r.bike ? `${r.bike.model} (${r.bike.vin})` : `${r.model || 'Bike'}${r.vin ? ` (${r.vin})` : ''}`;
  const who = r.customer?.full_name || r.customer_name || 'customer';
  const total = Number(r.total_price || 0);
  const pct = total > 0 ? Math.min(100, Math.round(((total - Number(balance)) / total) * 100)) : 100;
  return completed
    ? {
        kind: 'installment',
        title: '🎉 Reservation paid off',
        body: `UGX ${fmtUgx(amount)} from ${who} — ${bike} is fully paid (total UGX ${fmtUgx(total)})`,
        url: '/bikes',
        tag: 'installment:' + (r.id || ''),
        reservationId: r.id,
        amount: Number(amount || 0),
        completed: true,
      }
    : {
        kind: 'installment',
        title: '💵 Installment received',
        body: `UGX ${fmtUgx(amount)} from ${who} — ${bike} — UGX ${fmtUgx(balance)} balance (${pct}% paid)${paidByName ? ` · by ${paidByName}` : ''}`,
        url: '/bikes',
        tag: 'installment:' + (r.id || ''),
        reservationId: r.id,
        amount: Number(amount || 0),
        balance: Number(balance || 0),
        completed: false,
      };
}

/** Self-confirmation for the POS operator who recorded it — the durable
 *  counterpart of the ✅ toast, so "did it actually save?" always has an answer. */
function installmentSelf(r, amount, balance) {
  const completed = Number(balance) <= 0.01;
  return {
    kind: 'installment_recorded',
    title: '✅ Installment recorded',
    body: `UGX ${fmtUgx(amount)} received — UGX ${fmtUgx(balance)} balance remaining${completed ? ' · bike marked sold' : ''}`,
    url: '/',
    tag: 'installment:' + (r.id || ''),
    reservationId: r.id,
    amount: Number(amount || 0),
    balance: Number(balance || 0),
    completed,
  };
}

/** The POS finalized an approved credit sale — stock moved, debt opened. */
function creditFinalized(sale, actorName) {
  return {
    kind: 'credit_finalized',
    title: '🧾 Credit sale finalized',
    body: `${sale.receipt_no || sale.client_txn_id || 'Sale'} — UGX ${fmtUgx(sale.total)} — stock moved, debt open${actorName ? ` · by ${actorName}` : ''}`,
    url: '/credit',
    tag: 'credit-fin:' + (sale.id || ''),
    saleId: sale.id,
    receiptNo: sale.receipt_no,
  };
}

/** POS confirmed it saw a rejection — clears the desk queue. */
function creditRejectionAck(sale) {
  return {
    kind: 'credit_ack',
    title: '🗑️ Rejection confirmed',
    body: `${sale.receipt_no || 'Sale'} — POS confirmed receipt; removed from the credit queue`,
    url: '/approvals',
    tag: 'credit-ack:' + (sale.id || ''),
    saleId: sale.id,
    receiptNo: sale.receipt_no,
  };
}

/** Admin changed a user's grants — lands in that user's inbox (and push). */
function permissionGranted(summary, url) {
  return {
    kind: 'permission_grant',
    title: '🔐 Permissions updated',
    body: summary,
    url: url || '/',
    tag: 'permission-grant',
  };
}

/** A reorder list changed status — told to whoever created the list. */
function reorderStatus(list, status) {
  const label = {
    pending: 'back to pending',
    processed: 'marked processed — approved for ordering',
    fulfilled: 'fulfilled — stock received',
    cancelled: 'cancelled',
  }[status] || status;
  return {
    kind: 'reorder_status',
    title: '📋 Reorder update',
    body: `${list.title || 'Reorder list'} — ${label}`,
    url: '/',
    tag: 'reorder:' + (list.id || ''),
    reorderId: list.id,
    status,
  };
}

/** Admin edited a product's details (SKU / name / price / active / …).
 *  Tells admins the inventory card changed so pricing & promotions can be re-checked. */
function productUpdated(actorName, product, action = 'updated') {
  const name = (product && (product.name || product.sku)) || 'product';
  const labels = { created: 'created', updated: 'updated', deactivated: 'deactivated', deleted: 'deleted' };
  const label = labels[action] || action;
  const icon = action === 'created' ? '📦' : action === 'deleted' ? '🗑️' : '✏️';
  return {
    kind: 'product_update',
    title: `${icon} Product ${label}`,
    body: `${name}${actorName ? ` by ${actorName}` : ''}`,
    url: '/admin/inventory',
    tag: 'product:' + (product && product.id),
    productId: product && product.id,
    action,
  };
}

/** Stock count corrected/adjusted (damaged, transfer, count-fix, …).
 *  `product` is the row fetched BEFORE the mutation, so `product.stock_qty` is the old count. */
function stockAdjusted(actorName, product, delta, newQty, note, type) {
  const name = (product && (product.name || product.sku)) || 'product';
  const typeLabel = type && type !== 'adjustment' ? ` (${type})` : '';
  const sign = delta > 0 ? '+' : '';
  const notePart = note ? ` — ${note}` : '';
  return {
    kind: 'stock_adjustment',
    title: '📦 Stock adjusted',
    body: `${name}: ${product && product.stock_qty} → ${newQty} (${sign}${delta})${typeLabel}${notePart}${actorName ? ` by ${actorName}` : ''}`,
    url: '/admin/inventory',
    tag: 'stock:' + (product && product.id),
    productId: product && product.id,
    delta: Number(delta),
    newQty: Number(newQty),
    type,
  };
}

/** POS-confirmed sale payload — one inbox row per active POS-floor user
 *  (role NOT IN admin/manager): every terminal's bell shows it, the manager's
 *  bell never does. Title/body are taken straight from saleNotification, so
 *  the POS bell and OS notification read EXACTLY like the admin console's
 *  "🛵 New Sale" line. Two toasts ride along (the POS renders both):
 *    message  → "Sale #… · UGX <sale total>"
 *    message2 → "Today's revenue: UGX <running total to-date>"
 *  Revenue mirrors the /today window (completed, non-credit, server-day) so
 *  it resets to 0 at UTC midnight.
 */
function posSaleNotification(sale, revenueToday) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const total = Number(sale.total || 0);
  const revenue = Number(revenueToday || 0);
  return {
    ...saleNotification(sale), // shared copy with the admin console (title/body/receipt/…)
    kind: 'pos_sale', // POS poll baseline filters on this kind
    url: '/pos', // single-screen app — never deep-link to /sales
    tag: 'pos-sale-' + (sale.id || sale.client_txn_id || ''),
    saleId: sale.id,
    message: `Sale #${String(sale.receipt_no || '').slice(-6)} · UGX ${fmt(total)}`,
    message2: `Today's revenue: UGX ${fmt(revenue >= 0 ? revenue : 0)}`,
    revenueToday: revenue,
  };
}

/** POS sale helper: one inbox row per POS-floor user (user_id is NOT NULL
 *  in this schema, so the row fans out instead of sharing) + ONE SSE frame
 *  carrying the two toast lines. Non-blocking — a POS sale never fails on
 *  the notification path. */
async function posSale(sale, revenueToday) {
  try {
    const payload = posSaleNotification(sale, revenueToday);
    const users = await many(`SELECT id FROM users WHERE is_active AND role NOT IN ('admin','manager')`);
    if (users.length) await persist(users.map((u) => u.id), payload);
    // Live badge bump for open POS/Overview clients (SSE).
    // `at` (server clock) lets the client advance its poll baseline so the
    // 30s fallback never toasts the same sale twice.
    emit('notification.created', { kind: payload.kind, message: payload.message, message2: payload.message2, at: new Date().toISOString() });
  } catch (err) {
    console.error('[push] posSale failed:', err.message);
  }
}

module.exports = { notifyAdmins, notifyUser, saleNotification, stockWarning, revenueRecord, restockNotification, creditDecision, creditPayment, ensureConfigured, reservationCreated, releaseRequested, releaseDecision, installmentReceived, installmentSelf, creditFinalized, creditRejectionAck, permissionGranted, reorderStatus, productUpdated, stockAdjusted, posSaleNotification, posSale };
