# Production Protocol — Data Wipe, Activation & Credential Recovery

**Status:** PLAN (not yet implemented) · **Owner:** developer (you) · **Created:** 2026-09-23
**Scope:** `server/` (scripts + auth routes), `admin/` (codes UI), `pos/` (device reset)
**Guiding rule:** in production, *nobody* gets in except through a code you issued — and structure is never destroyed, only data.

---

## 1. Goals & non-goals

| Goal | How |
|---|---|
| Reset production to "factory" (data gone, structure intact) | Guarded CLI script — **not** a separate super-user app |
| Bootstrap the first admin after a wipe (no credentials exist) | One-time **Admin Code** minted by the developer |
| Admin who forgot their password reclaims admin | Same Admin Code flow (re-assign) |
| Staff who forgot their credentials get re-credentialed | **Reset codes** minted by the admin for that specific user |
| Everything auditable | Every code event lands in `audit_log` |

**Non-goals:** multi-tenant concerns; self-service recovery without a code; deleting schema/indexes; touching app binaries.

**Decision record:** a separate "super user app" was considered and rejected — it duplicates auth, needs its own deployment, and widens the attack surface. A CLI script on the server host + the existing `activation_codes` mechanism covers all goals with less code.

---

## 2. Current state (verified in code, 2026-09-23)

**Already exists — reuse:**
- `users` — `password_hash` nullable ("null until activation"), roles `admin/manager/cashier/mechanic` (`schema.sql:5`)
- `activation_codes` — staff self-register via `POST /api/auth/register` (`schema.sql:21`, `routes/auth.js:10`); **but its CHECK allows only `manager|cashier|mechanic` — no admin**
- `seed.js:17-29` — working ordered-DELETE wipe pattern to model the production script on
- `admin_recovery_codes` — **schema-only (`schema.sql:420`), zero references in code.** Its `created_by NOT NULL REFERENCES users(id)` makes it unusable for cold-start bootstrap (after a wipe no users exist). **Decision: drop this table and fold its purpose into `activation_codes`.**

**Missing (the gaps this plan closes):**
1. No production wipe script (`seed.js` only clears demo-prefixed rows, then re-inserts demo data)
2. No admin role possible via activation code → no bootstrap/reclaim path
3. No "reset credentials" flow (register = new users only; `change-password` requires the old password)
4. No admin UI for minting staff codes / reset codes (verify during Phase C)
5. No POS device-side reset for re-pointing a terminal at a wiped server

## 3. Design — one codes system, three purposes

Extend `activation_codes` (columns added by a one-time migration — see §7):

```sql
ALTER TABLE activation_codes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'register',
  ADD COLUMN IF NOT EXISTS reset_user_id UUID REFERENCES users(id);
-- kind:    'staff' | 'admin'      (admin codes minted ONLY by the CLI)
-- purpose: 'register' | 'reset'
-- reset_user_id: for staff reset codes — targets one existing user
```

Update the role CHECK so `'admin'` is legal **only when `kind='admin'`** (enforced in code + table CHECK).

### The three code types

| Code type | Minted by | Purpose | Claim result |
|---|---|---|---|
| **Admin Code** (`kind='admin'`) | `npm run code:admin` (CLI, developer's hands) | Bootstrap first admin after wipe **or** reclaim admin later | Code + name + email + new password → if no active admin exists, account created/upserted as `admin`; if one exists **with that email**, password reset in place; otherwise rejected (no hijacking a different admin) |
| **Staff register code** (`kind='staff'`, `purpose='register'`) | Admin UI (existing flow) | Onboard a new POS/manager user | Existing `/register` behavior |
| **Staff reset code** (`kind='staff'`, `purpose='reset'`, `reset_user_id=X`) | Admin UI, per user ("Reset credentials") | User forgot password | Code + new password → replaces user X's `password_hash` (old password NOT required); completes activation if hash was null |

### Rules for every code (non-negotiable)
- Stored **hashed** (sha-256); plaintext shown exactly once; format `SPIRO-XXXX-XXXX-XXXX` (Crockford base32, no ambiguous chars)
- Single-use (`used_at` set transactionally with the credential change)
- Admin Code: **no auto-expiry** (master key) but rotating it invalidates the old one; staff codes: 7-day expiry (current default)
- Rate-limit claims (5 attempts / 15 min / IP) against brute force
- Every mint/claim/reset writes `audit_log` (actor, code id, target user)

---

## 4. The wipe script — `server/src/scripts/reset-production.js`

`npm run wipe`. Plain Node + pg (same stack as seed.js), run on the server host.

**Behavior:**
1. **Guards** (all must pass, else abort exit 1): `NODE_ENV=production` (or explicit `--force-dev`); interactive phrase `WIPE SPIRO PRODUCTION` (or `--yes --yes` for scripted use); refuses a `DATABASE_URL` containing `localhost` without `--force-dev`
2. **Backup first**: `pg_dump` to `backups/pre-wipe-<timestamp>.sql` (abort if dump fails or < 1 KB)
3. **Wipe data, keep structure** — one `TRUNCATE … CASCADE RESTART IDENTITY` over the explicit table list from `schema.sql` (never dynamic discovery): `audit_log, push_subscriptions, stock_movements, credit_payments, sale_items, sales, approvals, customer_bikes, bike_installment_payments, bike_reservations, revenue_records, reorder_lists, consignments, expenses, bikes, products, expense_categories, customers, activation_codes, users, admin_recovery_codes`
4. **Mint the Admin Code immediately**, print plaintext **once**, store only the hash, write a `system_wipe` audit entry. Output ends: *"System locked. Awaiting admin activation with the code above."*
5. Options: `--keep-catalog` (preserve `products`/`bikes`/`expense_categories` for a "reset sales history" wipe) · `--skip-backup` (discouraged, logs a warning)

**After a wipe the system is intentionally unusable until:** admin claims the Admin Code → logs into the dashboard → mints staff codes → POS terminals re-activate.

## 5. Endpoint changes (`routes/auth.js` + `routes/codes.js`)

| Endpoint | Change |
|---|---|
| `POST /api/auth/register` | Branch on `kind`/`purpose`: admin-claim path (§3), staff register (existing), staff reset (`reset_user_id` + new password, no old password needed) |
| `POST /api/auth/claim-admin` | Admin Code flow (may fold into `/register`); rejects if an active admin exists whose email ≠ the one provided |
| `POST /api/admin/codes` | Mint staff register codes (existing behavior, now tagged `kind='staff'`) — **verify existing route in Phase C** |
| `POST /api/admin/users/:id/reset-code` | New — single-use reset code bound to that user; plaintext returned once |
| `POST /api/admin/codes/rotate-admin` | New — admin rotates the Admin Code (old hash invalidated) |

The Admin Code claim is the **only** unauthenticated privileged endpoint — it lives behind the rate limiter and the single-use transaction.

---

## 6. Rollout — step by step (each phase independently testable)

- **Phase A — Wipe script.** `reset-production.js` + guards + backup + `npm run wipe`. Test on dev DB: run → row counts 0 everywhere, structure intact, backup file exists, bootstrap code printed, guards abort on wrong phrase.
- **Phase B — Admin Code.** Schema migration + drop `admin_recovery_codes` + claim-admin flow. Test: wipe → claim → login → both events in `audit_log`.
- **Phase C — Staff reset codes + codes UI.** Reset-code endpoint + "Reset credentials" in the staff UI. Test: cashier forgets password → admin mints → cashier reclaims without old password; used/expired codes rejected.
- **Phase D — Devices & runbook.** POS "Reset device data" on the register screen (clears IndexedDB + localStorage, keeps the app) → re-activate with fresh staff code; final runbook pass. Test: wiped server + stale terminal → full recovery.

---

## 7. Known migration gotcha

`schema.sql` relies on `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, which are **no-ops on a live DB** for existing objects (this bit us before with `sale_items.created_at`). Phase B must ship a one-time migration file (`migrations/2026-xx-codes.sql`) run manually via `psql`, and the wipe script must verify the new columns exist before minting.

---

## 8. Operations runbook (final form after Phase D)

**Fresh production install:** provision DB → `npm run wipe` → hand Admin Code out-of-band (in person/phone, never email) → admin claims → admin mints staff codes → POS terminals activate → verify first sale + audit entries.

**Admin locked out:** run `npm run code:admin` on the server host (prints a fresh code, invalidates the old) → claim → done. Master-key access = **physical presence at the server**, never an HTTP endpoint.

**Staff forgot password:** admin → staff list → "Reset credentials" → hand the one-time code to the user → user reclaims at the login screen.

**Post-wipe POS terminals:** activate screen → "Reset device data" → fresh staff code → catalog re-syncs.

---

## 9. Session handoff (2026-09-23) — resume here

**Where this stands:** this document is the agreed plan; **nothing is implemented yet.** All four phases (§6) are pending. The analysis in §2 was verified against the code on this date and remains the source of truth.

**Key conclusions reached this session:**
1. **No "super user app"** — the developer's control channel is the server host itself (CLI: `npm run wipe`, `npm run code:admin`), never an HTTP endpoint.
2. **Wipe = data only** — `TRUNCATE … CASCADE RESTART IDENTITY` over the explicit table list (§4.3); structure, indexes and constraints are never touched. A pre-wipe `pg_dump` backup is mandatory.
3. **One codes system, three purposes** (§3): Admin Code (bootstrap/reclaim admin), staff register code (already exists), staff reset code (new — for forgotten passwords without the old password). All stored hashed, single-use, audited.
4. **`admin_recovery_codes` is dead weight** — schema-only, unusable by design (`created_by NOT NULL` can't survive a wipe); drop it in Phase B and fold its job into `activation_codes`.
5. **Streamlined build order is Phase A → B → C → D** (§6), each independently testable on the dev DB before touching anything real.

**To resume:** pick a phase and say *"start Phase A"* (or B/C/D). Phase A (`server/src/scripts/reset-production.js` + guards + backup + `npm run wipe`) is the recommended first move — it is self-contained and testable on the dev DB in one session.
