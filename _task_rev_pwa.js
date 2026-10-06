// Task: (1) revenue record → per-transaction day-cumulative content,
// (2) restore POS PWA installability in dev without the reload loop.
const fs = require('fs');

function edit(file, edits) {
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length - crlf;
  const eol = crlf >= lf ? '\r\n' : '\n';
  let c = raw.replace(/\r\n/g, '\n');
  for (const { label, oldText, newText } of edits) {
    const n = c.split(oldText).length - 1;
    if (n !== 1) { console.error(`${file}: [${label}] matched ${n} (need 1)`); process.exit(1); }
    c = c.replace(oldText, () => newText); // function → no $-pattern expansion
  }
  if (eol === '\r\n') c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, c, 'utf8');
  console.log(`${file.split('/').pop()}: ${edits.length} edits`);
}

// ---------- 1a. push.js: revenueRecord → day-cumulative body ----------
edit('c:/Users/manue/Desktop/spiro/server/src/services/push.js', [
  {
    label: 'revenueRecord',
    oldText: `/** Payload when revenue sets a new all-time high for a period ('week' | 'month'). */
function revenueRecord(newRevenue, prevRevenue, date, period = 'day') {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const label = period === 'month' ? 'month' : period === 'day' ? 'day' : 'week';
  return {
    kind: 'revenue',
    title: '📈 Revenue record',
    body: \`New all-time \${label} high: UGX \${fmt(newRevenue)} (\${date}; previous UGX \${fmt(prevRevenue)})\`,
    url: '/reports',
    tag: \`revenue-record:\${period}:\${date}\`,
    revenue: Number(newRevenue || 0),
    previous: Number(prevRevenue || 0),
    date,
    period,
  };
}`,
    newText: `/** Daily revenue line for the admin inbox — published on EVERY completed
 *  sale and credit settlement with the running day total (same window as
 *  /reports/today revenue and the POS toast message2). Replaces the old
 *  all-time-high-only alert; the week/month record rows still update
 *  silently in revenue_records. */
function revenueRecord(dayRevenue, date) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 });
  const revenue = Number(dayRevenue || 0);
  return {
    kind: 'revenue',
    title: '📈 Revenue record',
    body: \`Today's revenue: UGX \${fmt(revenue)} (\${date})\`,
    url: '/reports',
    tag: \`revenue:\${date}\`,
    revenue,
    date,
    period: 'day',
  };
}`,
  },
]);
console.log('push.js done');

// ---------- 1b. sales.js: fire every transaction + day-cumulative content ----------
edit('c:/Users/manue/Desktop/spiro/server/src/services/sales.js', [
  {
    label: 'checkRevenueRecords doc',
    oldText: `/**
 * Recompute the all-time-high week/month revenue and push a record
 * notification when beaten. Revenue = product sales (completed, non-credit)
 * + credit settlements received — a credit sale never counts here, not even
 * after approval; only the payments that dissolve its debt do.
 * Uses fresh pool queries, so it is safe to call from setImmediate after COMMIT.
 */`,
    newText: `/**
 * Publish today's cumulative revenue to the admin inbox on EVERY transaction
 * (completed, non-credit sales — the same window as /reports/today revenue
 * and the POS toast message2), and silently refresh the week/month
 * all-time-high rows in revenue_records.
 * Uses fresh pool queries, so it is safe to call from setImmediate after COMMIT.
 */`,
  },
  {
    label: 'bump + notify',
    oldText: `  const bump = async (period, total, label) => {
    const cur = Number(total || 0)
    const prev = await one(\`SELECT COALESCE(max(revenue),0) AS r FROM revenue_records WHERE period = $1\`, [period])
    if (cur > Number(prev?.r || 0)) {
      const rec = await one(
        \`INSERT INTO revenue_records (period, revenue, date) VALUES ($1, $2, CURRENT_DATE)
         ON CONFLICT (period) DO UPDATE SET revenue = $2, date = CURRENT_DATE
         RETURNING revenue\`,
        [period, cur]
      )
      if (pushSvc) pushSvc.notifyAdmins(pushSvc.revenueRecord(rec?.revenue || 0, prev?.r || 0, new Date().toISOString().slice(0, 10), label)).catch(() => {})
    }
  }

  try {
    await bump('week', (await periodTotal('week')).t, 'week')
    await bump('month', (await periodTotal('month')).t, 'month')
  } catch {}`,
    newText: `  // Silent bookkeeping: keep the week/month all-time-high rows fresh. The
  // admin-facing notification is the per-transaction daily figure below.
  const bump = async (period, total) => {
    const cur = Number(total || 0)
    const prev = await one(\`SELECT COALESCE(max(revenue),0) AS r FROM revenue_records WHERE period = $1\`, [period])
    if (cur > Number(prev?.r || 0)) {
      await one(
        \`INSERT INTO revenue_records (period, revenue, date) VALUES ($1, $2, CURRENT_DATE)
         ON CONFLICT (period) DO UPDATE SET revenue = $2, date = CURRENT_DATE
         RETURNING revenue\`,
        [period, cur]
      )
    }
  }

  try {
    await bump('week', (await periodTotal('week')).t)
    await bump('month', (await periodTotal('month')).t)
    // Every transaction republishes the running day total. CURRENT_DATE labels
    // the same day boundary the date_trunc window uses.
    if (pushSvc) {
      const day = await one(
        \`SELECT COALESCE(sum(total),0) AS r, to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d
           FROM sales
          WHERE status = 'completed' AND payment_method <> 'credit'
            AND created_at >= date_trunc('day', now())\`
      )
      pushSvc.notifyAdmins(pushSvc.revenueRecord(Number(day?.r || 0), day?.d)).catch(() => {})
    }
  } catch {}`,
  },
  {
    label: 'call-site guard',
    oldText: `      // All-time-high records: product revenue + credit settlements (see helper).
      checkRevenueRecords(pushSvc).catch(() => {})`,
    newText: `      // Daily revenue line for the admin inbox (see helper). Pending-credit
      // requests move no money, so they must not publish an unchanged figure.
      if (sale.status !== 'pending_credit') checkRevenueRecords(pushSvc).catch(() => {})`,
  },
]);
console.log('sales.js done');

// ---------- 2a. vite.config.ts: re-enable dev manifest + dev SW serving ----------
edit('c:/Users/manue/Desktop/spiro/pos/vite.config.ts', [
  {
    label: 'devOptions',
    oldText: `      // DEV ONLY: the dev service worker is intentionally DISABLED here. With
      // \`registerType: 'autoUpdate'\`, vite-plugin-pwa's registerSW calls
      // window.location.reload() inside the SW "activated" handler whenever
      // \`event.isUpdate || event.isExternal\` is true — and that path does NOT
      // consult \`onNeedRefresh\` (onNeedRefresh is only used in the non-autoUpdate
      // branch). So the onNeedRefresh callback in main.tsx could not stop it.
      // During \`vite\` dev the dev SW keeps re-activating across HMR cycles and
      // server restarts, which made the POS reload continuously. \`devOptions\`
      // only takes effect under the \`vite\` dev server; \`vite build\` (production)
      // is unaffected and still emits the auto-updating service worker so a
      // deployed kiosk still picks up new versions automatically.
      devOptions: { enabled: false },`,
    newText: `      // DEV: the manifest + a dev service worker are served so the app is
      // installable (PWA download / Add to Home Screen) from the dev server.
      // The reload loop from earlier stays fixed — main.tsx registers the
      // hand-written /sw-dev.js in dev (plain register, no update listeners).
      // With \`registerType: 'autoUpdate'\`, registerSW calls
      // window.location.reload() inside the SW "activated" handler whenever
      // \`event.isUpdate || event.isExternal\` is true, and the dev worker
      // re-activates across HMR cycles → continuous reloads. \`devOptions\`
      // only applies to \`vite\` dev; \`vite build\` still emits the
      // auto-updating worker so deployed kiosks self-update.
      devOptions: { enabled: true },`,
  },
]);
console.log('vite.config.ts done');

// ---------- 2b. main.tsx: dev registers /sw-dev.js; prod keeps registerSW ----------
edit('c:/Users/manue/Desktop/spiro/pos/src/main.tsx', [
  {
    label: 'register branch',
    oldText: `import { registerSW } from 'virtual:pwa-register'

registerSW({
  onNeedRefresh() {
    // autoUpdate mode handles reload; log for visibility
    console.log('[pwa] new POS version available')
  },
  onOfflineReady() {
    console.log('[pwa] POS ready to work offline')
  },
})`,
    newText: `import { registerSW } from 'virtual:pwa-register'

if (import.meta.env.DEV) {
  // Dev registers the hand-written /sw-dev.js (push handler + installability
  // fetch handler) with a plain register — no update listeners. The autoUpdate
  // registerSW below reloads the page on every SW activation, and the dev
  // worker re-activates across HMR cycles → continuous reloads.
  void navigator.serviceWorker.register('/sw-dev.js').catch(() => {})
} else {
  // Production: vite-plugin-pwa's auto-updating worker (kiosks self-update).
  registerSW({
    onNeedRefresh() {
      // autoUpdate mode handles reload; log for visibility
      console.log('[pwa] new POS version available')
    },
    onOfflineReady() {
      console.log('[pwa] POS ready to work offline')
    },
  })
}`,
  },
]);
console.log('main.tsx done');

// ---------- 2c. sw-dev.js: fetch handler (installability criteria) ----------
edit('c:/Users/manue/Desktop/spiro/pos/public/sw-dev.js', [
  {
    label: 'fetch handler',
    oldText: `importScripts('/push-handler.js')

self.addEventListener('install', () => {`,
    newText: `importScripts('/push-handler.js')

// Fetch handler: browsers require one for the installability criteria
// (PWA download / Add to Home Screen). Dev always goes to the network.
self.addEventListener('fetch', () => {})

self.addEventListener('install', () => {`,
  },
]);
console.log('sw-dev.js done');


