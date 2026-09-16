# Spiro ERP — Phase 1

Full-stack dealership system for **Spiro** e-bikes & spare parts (Uganda), implementing **Phase 1** of the ERP roadmap:

| Area | Delivered |
|---|---|
| **Inventory** | Spare parts (SKU/barcode/stock/reorder alerts) + individually VIN-tracked bikes, movement-based stock ledger, adjustments with audit |
| **POS** | Offline-first PWA — scan/search → cart → checkout (cash / mobile money / bank / card / credit) → receipts, discounts, stock deduction |
| **Customer CRM** | Auto-created at checkout, Customer 360 (bikes, purchase history, lifetime value) |
| **Reporting** | Today-default dashboard, hourly revenue chart, payment mix, top products, staff performance, range reports |
| **Controls** | Role permissions, discount >5% / credit-sale approvals, full audit trail |

Three apps, one folder:

```
spiro/
├── admin/       → Admin Dashboard (React + Vite + TS + Tailwind + Recharts)
├── pos/         → POS PWA (React + Vite + TS + Dexie/IndexedDB + Zustand, offline-first)
├── server/      → API (Node + Express + PostgreSQL + web-push)
├── package.json → `npm run dev` starts all three at once (concurrently)
└── SETUP.bat    → one-time database setup
```

---

## Quick start

### 0) One-time setup (creates DB + demo data)
Double-click **`SETUP.bat`** (or run `node server/scripts/setup-win.js`).
It prompts for your PostgreSQL password (hidden), creates the `spiro` database, writes `server/.env`, and seeds demo data.

> Requires PostgreSQL running locally. The script auto-detects PostgreSQL 17/18 under `C:\Program Files\PostgreSQL`.

### 1) Install everything (root)
```bash
npm install            # tooling (concurrently)
npm run install:all    # server + admin + pos dependencies
```

### 2) Start all three apps — one command
```bash
npm run dev
```

That single command (from the project root) starts everything with prefixed, color-coded logs:

```
[server] Spiro API listening on http://localhost:4000
[admin]  ➜ Local: http://localhost:5173/
[pos]    ➜ Local: http://localhost:5174/
```

| App | URL |
|---|---|
| API server | http://localhost:4000 |
| Admin Dashboard | http://localhost:5173 |
| POS PWA | http://localhost:5174 |

Run apps individually if you prefer: `npm run dev:server`, `npm run dev:admin`, `npm run dev:pos`. Ctrl+C stops all three at once (`--kill-others`).

> For true offline/PWA behavior, use the production build: `npm run build`, then `npm run preview` in `pos/` — the service worker only fully engages on the built app.

### Verify everything (51 automated checks)
With the server running:
```bash
npm run smoke           # 36 checks: auth, reports, sales, idempotent retry, offline sync push,
                        # approvals, roles, audit, VIN trace, codes
npm run test:offline    # 15 checks, POS.md Test F/G: half-synced sale in an offline batch,
                        # reconnect push, no double-deduction, retry no-op
```

---

## Demo logins (after seeding)

| App | Login | Password |
|---|---|---|
| Admin Dashboard | `admin@spiro.demo` | `admin123` |
| Admin (manager) | `manager@spiro.demo` | `manager123` |
| POS (activate with code) | code `SPIRO-DEMO1` | — (choose your own password) |
| POS (sign in instead) | `grace@spiro.demo` | `cashier123` |

Extra activation codes seeded: `SPIRO-DEMO2`, `SPIRO-MGR1` (generate more in **Team & Codes**).

---

## The three core flows

### 1. Operator activation (admin-generated code)
1. Admin: **Team & Codes → + Generate code** → copy `SPIRO-XXXXXX`
2. Operator: POS login screen → **Activate with code** → enters code + name + chooses password
3. Account is created server-side with the code's role; terminal stores the session

### 2. Selling (online or offline)
- **Scan** (any USB HID barcode scanner) or tap products → cart
- Checkout → payment method, discount, amount paid, optional customer
- Sale is written **atomically to IndexedDB first** (sale + items + sync-queue entry), receipt prints, stock adjusts locally
- If offline: sale sits in the queue; the status bar shows `Offline — selling continues` and `N sales queued`
- If online: `POST /api/sync/push` uploads it (idempotent via `client_txn_id` — retries never duplicate)

### 3. Notifications + sync
- The POS **polls `GET /api/health` every 30 s** (plus browser online/offline events and after every sale) — connection state shown in the status bar
- Every recorded sale triggers the server to send a **Web Push notification** to all subscribed admin/manager devices (VAPID)
- Admin: first login → click **🔔 Enable sale alerts** in the sidebar → allow the permission prompt
- Send a test from **Settings → Send test notification**

---

## Offline architecture (per POS.md)

- **PWA/service worker** keeps the app itself loadable offline (`vite-plugin-pwa`, autoUpdate, API traffic explicitly NetworkOnly)
- **IndexedDB (Dexie)** stores products, bikes, categories, sales, sale items, sync queue, settings, sync cursor
- **Scan locally, sell locally, store locally, sync later** — barcode lookups never touch the network
- Sync engine: health ping → push pending sales → pull incremental catalog changes (`since` cursor, bootstrap on first run)
- **Idempotency**: `client_txn_id` (unique on server + client) makes retries safe
- **Movement-based stock**: every deduction is a `stock_movements` row (`sale`, `purchase`, `adjustment`, `workshop`, `damaged`, `transfer`, `return`) with user + device attribution
- ** freshness is visible**: online/offline pill, last sync time, queued-sale counter, per-sale sync badge in History

## Stock adjustment (Phase 1 control)
Admin → Inventory → **Adjust** → +/− qty with type + note → written to movement ledger + audit log.

## Approvals (Phase 1 control)
- Discount > 5% at POS → auto-creates an approval request
- Credit sale → auto-creates an approval request
- Admin/manager decides on the **Approvals** page; every decision is audited

---

## API map

```
GET  /api/health                     ← POS connectivity probe
POST /api/auth/register|login        ← code activation / login
GET  /api/auth/me|staff, /change-password
GET  /api/reports/today|today/hourly|range|top-products|payments|cashiers|low-stock
GET  /api/admin/sales[/:id]          ← list/detail with items
GET|POST|PUT /api/admin/products|bikes
GET  /api/admin/bikes/lookup/:vin    ← VIN 360 trace
GET  /api/admin/customers[/:id]      ← Customer 360
POST /api/admin/inventory/adjust     ← stock movement + audit
GET  /api/admin/inventory/movements
GET|POST|DELETE /api/admin/codes     ← activation codes
PATCH /api/admin/users/:id           ← enable/disable, role
GET  /api/admin/approvals  POST /api/admin/approvals/:id/decide
GET  /api/admin/audit
GET  /api/push/vapid-public-key  POST /api/push/subscribe|unsubscribe
POST /api/admin/push/test
GET  /api/pos/catalog|sales|me/today
POST /api/pos/sales                  ← online checkout (idempotent)
POST /api/sync/push                  ← offline batch upload (idempotent)
GET  /api/sync/changes|bootstrap     ← incremental pull
```

## Configuration

- `server/.env` — `DATABASE_URL`, `PORT`, `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (keys already generated; regenerate with `npm run vapid` in `server/`)
- `admin/.env`, `pos/.env` — `VITE_API_URL` (defaults to `http://localhost:4000`)

## Production notes

- Serve `admin/dist` and `pos/dist` from any static host; keep `VITE_API_URL` pointing at the API
- **Push requires HTTPS** (except localhost) and VAPID keys in the server env
- Change `JWT_SECRET` before deploying
- The seed script is dev-only demo data — wipe by re-running after clearing, or just delete rows in `sales`/`products` via SQL
- iOS push needs the PWA added to the Home Screen (Safari 16.4+)
