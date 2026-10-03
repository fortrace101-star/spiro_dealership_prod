# Refactor Phase 2 — Implementation Plan

> Status: **APPROVED — executing.** Progress logged in `Refactor_Phase_2_Progress.md`.
> Decisions confirmed: (1) reorder **cancel = admin-only**, (2) product with sales history → **deactivate** (never orphan financial history), (3) **orange "Cancel" in both places** (POS header toggle + Adjust Inventory modal footer), gray when the label reads "Adjust inventory".

---

## 0. Decisions & standing rules

| # | Question | Decision |
|---|---|---|
| D1 | Who can cancel a reorder list? | **Admin role only** (`requireRole('admin')`), in addition to the existing `reorder_manage` permission. |
| D2 | Deleting a product that has sales history? | Try hard `DELETE`; on FK violation (`sale_items` reference) respond `409 { can_deactivate: true }` and the UI offers **Deactivate** (`active = false`). Sales/credit history is never orphaned. |
| D3 | Cancel-button styling | **Orange (`btn-warn`) whenever a control reads "Cancel"** — the POS header stock-mode toggle *and* the Adjust Inventory modal footer. Idle label ("Adjust inventory") stays gray `btn-ghost`. |
| D4 | Toasts | The toast system is **never** removed while removing the notification (bell inbox) container. New admin actions must raise toasts via a new admin `Toaster`. |
| D5 | Service Jobs | Removed from the sidebar earlier; **routes are kept**. |

---

## Workstream A — Notification container: unread-only + purge from DB

**Server** `server/src/routes/notifications.js`
- `GET /` → return only **unread** rows (`WHERE read_at IS NULL`) for the container + unread count.
- New `DELETE /api/notifications` → `DELETE FROM notifications WHERE user_id = $1` (clear-all, permanent).
- New `DELETE /api/notifications/:id` → purge one row.
- Keep `POST /read-all` (mark-all-read) and `POST /:id/read` for compatibility.
- Keep the 30/90-day pruning in `server/src/services/push.js`.

**Clients** `admin/src/components/Layout.tsx`, `pos/src/components/POSScreen.tsx`
- List renders unread only (drop the read/greyed branch).
- Header action becomes **"Clear all"** → `DELETE /api/notifications` → list empty, badge 0, **toast "Notifications cleared"**.
- Row click → mark read + delete row + refresh badge.

## Workstream B — Auto-subscribe push; remove Enable buttons; iOS/PWA

- Remove enable buttons: `admin/src/components/Layout.tsx` sidebar block (~L284), `pos/src/components/POSScreen.tsx` header (~L455).
- `usePush.ts` (both apps) gains `ensurePush()` run on **mount + `visibilitychange` + `online` + SW updatefound**:
  1. unsupported / insecure → silent stop
  2. existing subscription → done
  3. `permission === 'granted'` → subscribe + `POST /api/push/subscribe` (fully automatic)
  4. `permission === 'default'` → request immediately (Chromium/Firefox); on WebKit attach a **one-time `pointerdown`/`keydown` listener** (gesture required — fires on the first tap anywhere, no visible button)
  5. `permission === 'denied'` → silent; one-time info toast on iOS/Android
- iOS needs the installed PWA: `admin/index.html` gains `apple-mobile-web-app-capable`, `apple-touch-icon`, `apple-mobile-web-app-status-bar-style` (POS already has them); both manifests verified `display: standalone` + 192/512 icons.
- `isIOS && !navigator.standalone` → one-time informational toast/banner "Share → Add to Home Screen" (not a button).
- Background delivery with app closed already works via SW `push` → `showNotification`.


## Workstream C — Notification popup above the Approvals list

- Render the bell panel through `createPortal(document.body)`, `fixed right-4 top-16 z-[100]`, scrim `z-[90]`, in admin `Layout.tsx` and POS — always above the Approvals list regardless of local stacking contexts.

## Workstream D — Immediate cross-stack state updates (SSE)

- New `server/src/routes/events.js`: `GET /api/events` (auth) `text/event-stream`, module-level `emit(type, payload)`, 25s heartbeat, cleanup on close; mounted in `app.js`.
- Emit after commit: `sale.created`, `approval.created`, `approval.decided`, `stock.changed`, `reorder.status`, `notification.created`, `product.updated`.
- Admin `Layout.tsx` + POS: one reconnecting `EventSource` → instant badge recount + targeted refetch; POS triggers `runSyncCycle('sse')`. Existing polling stays as fallback.

## Workstream E — Reorder lists editable + cancellable (admin)

**Server** `server/src/routes/purchasing.js`
- New `PATCH /api/purchasing/reorders/:id` — edit `{ title, notes, items[] }`; validate lines like create; reject when status is `fulfilled`/`cancelled`; `audit_log` `update_reorder`; bump `updated_at`.
- `PATCH /reorders/:id/status` → **`cancelled` now requires `role === 'admin'`**; reject cancelling an already-fulfilled list; keep creator notification.

**Admin** `admin/src/pages/ReordersPage.tsx`
- Detail modal footer (pending/processed) adds **Edit list** (`btn-ghost`) and **Cancel list** (`btn-danger`, admin-only, confirm dialog).
- Cancel → `api.updateReorderStatus(id, 'cancelled')` → **toast** → reload list + counts + close.
- Edit form (title, notes, per-line qty/unit cost, add/remove line) → save → toast + reload.

## Workstream F — PDF receipt for "Print Receipt"

## Workstream G — Merge Edit Product → Adjust Inventory; delete/deactivate product

**POS**
- `AdjustInventoryModal.tsx` absorbs `EditProductsModal` fields (name, SKU, barcode, category, brand, supplier, cost/selling price, min stock, reorder level, active) above the adjust section; actions: **Save details** + **Apply adjustment** + orange **Cancel**.
- `POSScreen.tsx`: single **"Adjust inventory"** button (`canAdjustInventory || canEditProducts`); delete `edit-products` branches + `EditProductsModal.tsx`.
- **Orange toggle**: `.btn-warn` in `pos/src/index.css`
  `@apply btn bg-orange-500/15 text-orange-300 border border-orange-500/40 hover:bg-orange-500/25;`
  Header button: `stockMode === 'adjust-inventory' ? 'btn-warn … ✕ Cancel' : 'btn-ghost … Adjust inventory'`. Product-card highlight `border-amber-500/30` → `border-orange-500/40`.

**Permissions**
- `admin/src/pages/TeamPage.tsx`: remove `product_edit` option; `inventory_adjust` hint → "Adjust stock and edit product details".
- `admin/src/lib/types.ts`: keep `product_edit` as a legacy alias only.
- `server/src/services/permissions.js` (catalog): `product_edit` deprecated → expands to `inventory_adjust`.
- `PUT /api/admin/products/:id`, `PUT /api/pos/products/:id` guards → `requirePermission(['inventory_adjust', 'product_edit'])`.
- Bootstrap `can_edit_products` computed as `inventory_adjust || product_edit`.


---

## Execution order

| # | Step | Risk | Status |
|---|---|---|---|
| 1 | I1 custom-range layout fix | Low | ☐ |
| 2 | A notifications unread-only + DB purge | Low | ☐ |
| 3 | H admin ToastHost | Low | ☐ |
| 4 | C popup portal over Approvals | Low | ☐ |
| 5 | F native PDF receipt | Low | ☐ |
| 6 | G merge Edit Product → Adjust Inventory + orange toggle + permission fold | Medium | ☐ |
| 7 | G admin delete/deactivate product | Medium | ☐ |
| 8 | E admin edit + cancel reorder list (admin-only) | Medium | ☐ |
| 9 | B auto-subscribe + remove enable buttons + iOS/PWA | Medium | ☐ |
| 10 | D SSE live updates | Highest | ☐ |
| 11 | I2 expanded report content | Low–Med | ☐ |
| — | Validate: `tsc` + `vite build` (admin & pos), restart server, smoke tests | | ☐ |

## Validation checklist

- [ ] `npm run build` clean in `admin/` and `pos/` (tsc + vite).
- [ ] Server starts; notifications purge, reorder cancel (admin-only), product delete/deactivate all verified.
- [ ] POS: toggle reads orange "✕ Cancel" / gray "Adjust inventory"; modal Cancel orange; toasts appear.
- [ ] Admin: custom range applies on Overview; notification popup floats over Approvals; toasts show for new actions.
- [ ] SSE pushes badge updates across admin/POS; push auto-subscribes without any button.
- [ ] Download Report (today / 2 weeks / custom) contains the new sections.

**Delete / deactivate (admin only)**
- Server: `DELETE /api/admin/products/:id` — `requireRole('admin')`; hard delete; catch Postgres `23503` → `409 { error, can_deactivate: true }`; `audit_log` entries `delete_product` / `deactivate_product`.
- `admin/src/lib/api.ts`: `deleteProduct(id)`; `admin/src/pages/InventoryPage.tsx`: **Delete** (`btn-danger`, confirm) on the detail modal → on 409 offer **Deactivate**; toast either way.

## Workstream H — Admin toast host (toasts must keep showing)

- New `admin/src/components/Toaster.tsx`: module emitter + `showToast(title, body?)` + `<ToastHost />` (same card style/z-index as today's push toast).
- `Layout.tsx` push/sale toasts + chime route through the host (no behavioural change).
- Wired: reorder cancel, reorder edit saved, product delete/deactivate, notifications cleared, report downloaded. POS keeps its existing `flash` toast (already on every modal `onDone`).

## Workstream I — Download Report detail + Overview custom-range fix

- **Fix custom range first**: `admin/src/components/PeriodPicker.tsx` custom panel (negative-margin full-row trick) breaks inside Overview's `w-[220px]` filter column → render the panel on its own full-width row while the select keeps the narrow column; `resolveRange(period)` then feeds `load()`/`api.range` correctly.
- Extend `admin/src/lib/report.ts`: key figures + discounts, credit collected, credit outstanding, reservations collected; revenue graph (hourly today / daily otherwise); payment mix; per-method summary table; **reorder lists prepared in period** (incl. cancelled, with status); **stock received (consignments) in period** with landed totals; reservations/installments; staff performance; top products; low-stock snapshot.
- New aggregate endpoint `GET /api/reports/period?from&to` (one round-trip). Existing `/range`, `/payments`, `/top-products` untouched for the on-screen cards.


- Replace HTML→canvas→JPEG path (`pos/src/components/ReceiptModal.tsx`) with a native vector receipt PDF: new `pos/src/lib/pdf.ts` (slim port of `admin/src/lib/pdf.ts`), **80mm thermal-style page**, shop header, receipt no, date, cashier, line items, subtotal/discount/total, payment method/paid/change, customer, footer. `Print receipt` button → `save('receipt-<no>.pdf')`.
