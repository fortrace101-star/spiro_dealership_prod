# Forward — Unimplemented Work, Sorted

**Created:** 2026-09-23 · **Source:** session audit of everything left unbuilt ("inventory 2" = item 2 of the unimplemented list)
**Companion docs:** `Production_Protocol.md` (wipe + codes plan), `admin/table.md` (UI conventions)

---

## 1. Item 2a — Manager access to Credit & Approvals is broken (server-side)

### The corrected facts (verified in code, 2026-09-23)

- **Earlier claim was stale:** I had reported "the credit-payment route is `requireRole('admin')`, so managers get a 403." That route was since changed — `POST /admin/sales/:id/credit-payments` is now `requireRole('manager')` (`routes/admin.js:700`), and `requireRole('manager')` admits admin **or** manager (`middleware/auth.js:20`). **Payments already work for managers.**
- **The real bug is in the read/decision routes.** `requireRole()` with **no arguments** means **admin-only**: the middleware checks `admin || roles.includes(...)` against an empty array (`middleware/auth.js:20`).
- Affected routes, all bare `requireRole()`:
  - `GET /admin/credit/sales` — `admin.js:682` (the whole Credit ledger)
  - `GET /admin/approvals` — `admin.js:621`
  - `POST /admin/approvals/:id/decide` — `admin.js:639` (**approve/reject, including credit-sale decisions**)
- Yet the client role matrix deliberately grants managers both pages: `admin/src/lib/access.ts:10` (`/approvals`) and `:12` (`/credit`).

### Net effect

A manager can open Credit and Approvals from the menu, but **every data fetch returns 403** — both pages render empty/error for the exact roles the matrix says should work there. The credit approval flow (which the POS push-notification workflow depends on) is admin-only in practice. This went unnoticed because all testing was done as admin.

### Options

| Option | Change | Result |
|---|---|---|
| **A (recommended)** | Three routes → `requireRole('manager')` | Managers see and decide Credit + Approvals; matches `access.ts` intent; `requireRole('manager')` = "admin or manager" is the established pattern in the same file |
| **B** | Remove `manager` from `access.ts:10,12` | Managers lose both menu entries; zero server changes |

**Decision needed: A or B.**

---

## 2. Item 2b — Offline credit-payment queue (POS)

### The asymmetry (verified in code)

- The server was **designed** for it: `services/credit.js:169` — *"Idempotent on client_txn_id — **the POS queues payments offline**"* — but no queue exists in the POS.
- Server readiness is complete: `client_txn_id` required (`credit.js:177`); duplicate detection returns `200 { duplicate: true }` (`credit.js:196`) — retries are free and safe.
- POS today: `CreditModal` is deliberately read-only offline — Finalize and Receive-payment both `disabled={!online}` (`CreditModal.tsx:223,320`).

### Recommendation if built

**Queue payments only; keep Finalize online-only.** Payments are idempotent, amount-bounded, carry no stock risk. Finalize depends on the server's live sold-out check (the 409 guard) and must stay synchronous.

**Mechanics:** on submit while offline, store the payment in a small IndexedDB outbox with a **pre-generated `client_txn_id`** (`pos-pay-…`), mark it "queued" in the Credit desk, flush on the `online` event + after sync cycles (same outbox pattern as `services/sync.ts`). Treat a `duplicate: true` response as success.

**Decision needed: build now or defer.**

## 3. Bonus finding — the dev-wipe endpoint is a production landmine

- `POST /admin/dev/wipe` (`admin.js:727`) truncates the transactional tables over **HTTP with no `NODE_ENV` guard** — in production any authenticated admin could erase the database with one click via the sidebar button "🧹 Dev: reset all data" (`Layout.tsx:226`, self-marked *"remove before production"*).
- It is also an **incomplete wipe**: misses `bike_reservations`, `bike_installment_payments`, `revenue_records`, `expenses`, `expense_categories`, `consignments`, `reorder_lists` — unlike the planned `reset-production.js` (Protocol §4), which carries the full explicit table list.
- **Action:** fold into **Production Protocol Phase A** — delete the endpoint + button, or gate both to non-production (`NODE_ENV !== 'production'` server-side; env-flag the button client-side).

**Decision needed: delete vs. gate (either way it happens inside Phase A).**

---

## 4. Production Protocol — all four phases still unbuilt (plan-only)

`Production_Protocol.md` is complete as a plan; **no code exists yet** (verified: `server/src/scripts/` holds only `seed.js` + `generate-vapid.js`; no `migrations/` directory; no `wipe`/`code:admin` npm scripts).

| Phase | Deliverable | Note |
|---|---|---|
| **A** | `reset-production.js` + guards + `pg_dump` backup + `npm run wipe` | **Also absorbs the dev-wipe retirement (§3)** |
| **B** | Schema migration (`kind`/`purpose`/`reset_user_id` on `activation_codes`), claim-admin flow, drop dead `admin_recovery_codes` | Manual `psql` migration step required (Protocol §7 gotcha) |
| **C** | Staff reset codes + "Reset credentials" admin UI + `rotate-admin` | |
| **D** | POS "Reset device data" + final runbook pass | |

**Recommended first move:** Phase A — self-contained, testable on the dev DB in one session.

---

## 5. Database housekeeping (one manual SQL step)

- **`sale_items.created_at` is missing on the live table** — added to `schema.sql` after the table existed; `CREATE TABLE IF NOT EXISTS` never backfills. Worked around with `ORDER BY si.id` in the credit search, but any future feature assuming that column will fail the same way.
- **Fix:** one manual `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();` on the live DB (backfill value is cosmetic — historical rows share the sale timestamp anyway).

---

## 6. Verification that needs a human (software done, hardware/browser untested)

1. **End-to-end push**: POS "Enable alerts" → admin approves a credit → notification + beep lands on the POS. Needs a running server with VAPID keys.
2. **Real barcode hardware scan**: software path typechecked (`barcodeScanner.ts` → local IndexedDB lookup → cart); no physical gun has fired at it yet.
3. **Browser pass of new UIs**: Bike Reservations card/drawer (SQL-verified against live data, never rendered), Credit desk flows, Credit ledger search.

---

## Pending decisions summary

| # | Question | Options |
|---|---|---|
| 1 | Manager access to Credit/Approvals | **A**: open the three routes (`requireRole('manager')`) · **B**: lock pages to admin |
| 2 | Offline credit-payment queue | build now · defer |
| 3 | Dev-wipe endpoint | delete · gate to non-production (inside Protocol Phase A either way) |
