# Mobile Table Layout Standard

This document records the mobile-responsive standard applied to the admin
dashboard's data tables, so that no table needs a horizontal scroll bar on a
phone. It is the reference for the two tables that implement it today
(**Customers**, **Audit Trail**) and the pattern to follow when converting the
remaining tables.

Companion document: `cards.md` (dashboard cards, KPI grids & responsive
typography).

---

## The problem

Every table is wrapped in `<div className="overflow-x-auto card">`. On desktop
that is harmless; on a 360–414 px phone it produces a horizontal scroll bar, and
the row's most important content gets pushed off-screen behind it.

The standard replaces "scroll to see everything" with **"show the essentials,
tap for the rest"**.

---

## The rules

### Rule 0 — The developer decides which columns stay visible (recorded here)

Which fields remain on the phone screen is a **development decision made by the
developer** — not a question put to the end user, and not a runtime preference.
The decision is recorded in this document: the **Implemented tables** section
states, per table, which columns are display fields and which move into the
drawer, so the presentation is explicit and reviewable in one place.

When converting a table, derive the display set from the data's importance:

- Keep the columns that identify the row and carry its headline value —
  Reference, Customer, VIN, Receipt, Items total, When.
- Move supporting detail into the drawer — Supplier, Delivery, Prepared by, cost
  breakdowns, raw JSON.
- Never hide a table's only identifying column, and never leave a hidden column
  without a home in the drawer (Rule 2).
- Column choices are **per table**, and apply to the phone breakpoint only: from
  `sm:` (640 px) upward every column is shown again.

The lists under **Implemented tables** and **Rollout plan** are the register of
those decisions — update them whenever a table's display set changes.

### Rule 1 — Secondary columns are hidden on phones (`.col-opt`)

Columns that are useful but not essential get the `col-opt` class on **both**
the `<th>` and every matching `<td>`. They disappear below 640 px and return
from small tablets up.

```tsx
<th className="th col-opt">Location</th>
…
<td className="td col-opt text-slate-400">{c.address || '—'}</td>
```

### Rule 2 — The row becomes tappable and opens a detail drawer

Hiding a column is only acceptable if the data is still reachable. Every table
that uses `col-opt` **must** have a per-row detail view.

```tsx
<tr
  key={c.id}
  className="hover:bg-slate-800/30 cursor-pointer"
  onClick={() => open(c.id)}
>
```

On mobile, the row advertises the tap-through with a chevron placed after the
last visible cell:

```tsx
<span className="sm:hidden text-slate-600 text-xs">›</span>
```

The drawer is a right-side panel (`360°` style), identical in both tables:

```tsx
<div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
  <div className="absolute inset-0 bg-black/60" />
  <div
    className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto"
    onClick={(e) => e.stopPropagation()}
  >
```

### Rule 3 — The widest remaining column gets a compact mobile form

Whichever column is widest on a phone is rendered twice: a short form on
mobile, the full form from `sm:` up. Only one is in the layout at a time.

| Table | Column | Mobile (`sm:hidden`) | `sm:` and up (`hidden sm:inline`) |
|---|---|---|---|
| Customers | Lifetime value | `compactUgx()` → `UGX 12.5M` | `ugx()` → `UGX 12,500,000` |
| Audit Trail | When | `timeAgo()` → `2h ago` | `dateTime()` → `20 Sep, 14:32` |
| Inventory | Cost | `compactUgx()` → `UGX 12.5M` | `ugx()` → `UGX 12,500,000` |
| Inventory | Price | `compactUgx()` → `UGX 12.5M` | `ugx()` → `UGX 12,500,000` |

```tsx
<td className="td text-right font-semibold text-white tabular-nums whitespace-nowrap">
  <span className="sm:hidden">{compactUgx(c.lifetime_value)}</span>
  <span className="hidden sm:inline">{ugx(c.lifetime_value)}</span>
</td>
```

Helpers live in `src/lib/format.ts`: `ugx`, `compactUgx`, `num`, `dateTime`,
`dateOnly`, `timeAgo`. Add a compact helper there rather than inlining logic.

`compactUgx` rounds to the **nearest 100** before applying the K/M suffix, and
trims trailing zeros — so compact values stay faithful instead of drifting:
`1,500 → UGX 1.5K`, `68,500 → UGX 68.5K`, `89,500 → UGX 89.5K`,
`1,575,500 → UGX 1.5755M`, `2,000,000 → UGX 2M`, `300 → UGX 300`.
Admin and POS share these rules (their `format.ts` files are identical).

### Rule 4 — One primary cell, one muted subline

The identifying cell carries `font-medium text-white`; any secondary line inside
the same cell is `text-[11px] text-slate-500`.

**Barcode rule:** identifier sublines show the **SKU only**. Barcodes are
deliberately kept out of table cells — they are too long for a phone subline and
push rows wide — and live in the row's detail drawer header instead (where the
full `sku · barcode` line is shown). Applies to Inventory's product cell.

```tsx
<td className="td">
  <div className="text-sm font-medium text-white">{e.user_name || 'System'}</div>
  <div className="text-[11px] text-slate-500 capitalize">{e.user_role || ''}</div>
</td>
```

---

## Utility: `.col-opt`

**File:** `src/index.css` (inside `@layer components`, next to `.th` / `.td`)

```css
/* Optional table column: hidden on phones, restored from small tablets up. */
.col-opt {
  display: none;
}
@media (min-width: 640px) {
  .col-opt {
    display: table-cell;
  }
}
```

- `display: table-cell` (not `block`) is required in the media query so the
  column rejoins the table grid correctly.
- 640 px is Tailwind's `sm:` breakpoint — the same boundary the `sm:hidden` /
  `hidden sm:inline` helpers use, so column-hiding and value-swapping always
  agree.

---

## Implemented tables

### Customers — the reference implementation

**File:** `src/pages/CustomersPage.tsx`

| Column | Mobile | Notes |
|---|---|---|
| Customer | shown | `font-medium text-white` |
| Phone | shown | `text-slate-400 font-mono text-xs` |
| Location | `col-opt` | in the drawer as the customer's address |
| Purchases | `col-opt` | in the drawer as the "Transactions" card |
| Lifetime value | shown, compact | `compactUgx` on phone, `ugx` from `sm:` up |

The drawer shows the customer name, phone, address, a Lifetime value card, a
Transactions count card, linked Bikes, and full Purchase history.

### Audit Trail — same standard, different columns

**File:** `src/pages/AuditPage.tsx`

| Column | Mobile | Notes |
|---|---|---|
| When | shown, compact | `timeAgo` on phone, `dateTime` from `sm:` up |
| User | shown | name `font-medium text-white` + role `text-[11px] text-slate-500` |
| Action | shown | `Badge` + mobile chevron |
| Entity | `col-opt` | in the drawer with the full entity UUID |
| Changes | `col-opt` | in the drawer as Old value / New value / Meta blocks |

The Audit page had no per-row view before, so a drawer was added in this pass —
without it, hiding Entity and Changes would have made them unreachable on a
phone. Values are rendered through a `prettyValue()` helper that
`JSON.stringify`s objects with 2-space indent and returns `—` for empties, inside
`<pre className="… whitespace-pre-wrap break-words font-mono">` so long JSON
wraps instead of reintroducing a scroll bar.

### Received Consignments / Reorder lists — Purchasing page

**File:** `src/pages/ReordersPage.tsx` (both tabs share one table)

Display set (Rule 0): **Reference, Items Total, When**.

| Column | Mobile | Notes |
|---|---|---|
| Reference (or List) | shown | notes and the "Fulfills" line ride along as the muted subline |
| Items | `col-opt` | the modal shows the item count and the full item table |
| Supplier | `col-opt` | the modal meta line shows `Supplier: …` |
| Items total (or Est. value) | shown, compact | `compactUgx` on phone, `ugx` from `sm:` up |
| Delivery | `col-opt` | the modal footer shows Delivery and Landed total |
| Prepared by | `col-opt` | the modal meta line shows `prepared by …` |
| When | shown, compact | `timeAgo` on phone, `dateTime` from `sm:` up |

Adding the Supplier line to the modal was required by Rule 2: it was a table
column that had no representation in the modal, so hiding it would have made it
unreachable on a phone.

---

## Rollout plan for the remaining tables

Hide in this order (most overflow first). The "Keep on mobile" column below is
the developer's chosen display set for each table (Rule 0) — apply it, then keep
the record current when a table's data or priorities change. Add `col-opt` to the
`<th>` **and** every matching `<td>` for the hidden ones, and verify a detail
view exists or add one (Rule 2).

| Page / table | Keep on mobile | Hide with `col-opt` |
|---|---|---|
| Inventory (main) | ✅ done | Category, Status, Actions (phones merge Cost/Price into one stacked column; PC keeps them separate) |
| Sales (main, 7 cols) | ✅ done | Receipt, Cashier, Customer |
| Sales (items sub-table) | all — already fits | — |
| Purchasing (item table inside the modal) | SKU, Product, Qty, Line total | Unit cost |
| Bikes (7 cols) | ✅ done | Battery (Model/VIN + Cost/Price stack on phones, separate on PC) |
| Reservations | ✅ done | Plan, Down (phones: Model over dot+VIN merged cell; Total/Paid/Balance stack; no Actions — rows open the detail modal on every breakpoint) |
| Approvals (5 + action) | Type, Request, Status + actions | Requested by, When |
| Team & codes (4 cols) | all four | Expires, only if it still overflows |
| Settings (staff, 5 cols) | Name, Revenue | Sales, Profit, Discounts |
| Overview (low stock, 3 cols) | all three | — |
| Overview (stock value, 5 cols) | Product, In stock, Stock value | Min, Reorder at |
| Overview (recent sales, 5 cols) | Receipt, When, Total | Customer, Status/Method |
| Customers | ✅ done | Location, Purchases |
| Audit Trail | ✅ done | Entity, Changes |
| Purchasing (Received consignments / Reorder lists) | ✅ done | Items, Supplier, Delivery, Prepared by |

**Sales note:** ~~the main Sales table has no per-sale drawer equivalent to
Customers/Audit~~ resolved — Sales rows already open the right-side detail
drawer (`openDetail`), which contains the receipt number, cashier, customer,
payment method, status and full profit breakdown, so hiding columns is safe.

### Sales — approved display set

**File:** `src/pages/SalesPage.tsx`

| Column | Mobile | Notes |
|---|---|---|
| Receipt | `col-opt` | still visible in the drawer header (`openDetail`) — the row's identifying reference remains reachable (Rule 2) |
| Date | shown, compact | `timeAgo` on phone, `dateTime` from `sm:` up (same pattern as Audit Trail) |
| Cashier | `col-opt` | in the drawer as the "Cashier" card |
| Customer | `col-opt` | in the drawer as the "Customer" card |
| Payment | shown | `Badge` unchanged |
| Total | shown, compact | `compactUgx` on phone, `ugx` from `sm:` up |
| Profit | shown, compact | `compactUgx` on phone, `ugx` from `sm:` up; last visible cell on mobile, carries the `›` chevron |

Display set approved by the developer (Rule 0): **Date, Payment, Total, Profit**
visible on mobile; Receipt, Cashier, Customer hidden. Pagination was already in
place (`usePageSize()`, 10 mobile / 20 PC) before this conversion.

### Bikes — approved display set

**File:** `src/pages/BikesPage.tsx`

| Column | Mobile | Notes |
|---|---|---|
| Model + VIN | shown, stacked | primary cell — Model over the `VIN : <vin>` subline (breakpoint split: `sm:hidden` stacked cell, `col-opt` separate VIN/Model columns on PC) |
| Battery | `col-opt` | in the drawer as Battery serial / Battery spec cards |
| Cost / Price | shown, stacked, compact | merged cell on phones (Cost over a thin hr over Price, colors kept, `compactUgx`); separate Cost and Price columns on PC with full `ugx` |
| Status | shown | `Badge` unchanged; last-cell `›` chevron lives in Customer |
| Customer | shown | `text-slate-400`; carries the mobile chevron |

Rows open a bike detail drawer (VIN, battery, motor, cost, odometer, location,
customer, dates) with 360-trace and Reserve actions. Display set approved by the
developer (Rule 0).

### Inventory - approved display set

**File:** `src/pages/InventoryPage.tsx`

| Column | Mobile | Notes |
|---|---|---|
| Product | shown | name `font-medium text-white` + SKU-only subline (barcode lives in the drawer header, per the Rule 4 barcode rule) |
| Category | `col-opt` | in the drawer as the "Category" card |
| Cost / Price | shown, stacked, compact (phones only) | one merged cell on phones: Cost over Price split by a thin `border-t border-slate-800/80` divider; both lines `compactUgx`, Cost muted `text-slate-400`, Price white; from `sm:` up the merged cell is replaced by separate full-width Cost and Price columns (`col-opt`) showing `ugx()` |
| Margin | shown | percentage, `tabular-nums` |
| Stock | shown, colored | count, `tabular-nums`, tinted with its status color (emerald / orange / red) so the status reads without the Status column; carries the `›` chevron on phones |
| Status | `col-opt` | OK / Low / Out dot from `sm:` up only — the colors are already on the Stock cell; a mobile-only legend under the table spells out the three colors (OK — in stock, Low — at/below reorder level, Out — zero stock) |
| Actions | `col-opt` | Edit / History / Adjust from `sm:` up; on phones the drawer footer has Movement history / Adjust stock / Edit product, with `stopPropagation` on the cell |

Display set approved by the developer (Rule 0): **Product, Cost/Price (merged on
phones only), Margin, Stock** visible on mobile; Category, Status and Actions
hidden (`col-opt`). Stock carries the status color on mobile, with a legend row
under the table; from `sm:` up the table shows separate Cost, Price and Status
columns. A product detail drawer was added in this pass (Rule 2) showing every
hidden column plus brand, supplier, stock value, min stock, reorder level,
status and last-updated. Pagination added with `usePageSize()` (10 mobile /
20 PC); page resets to 1 on filter change.

---

### Reservations — approved display set

**File:** `src/pages/ReservationModals.tsx`

| Column | Mobile | Notes |
|---|---|---|
| Status + Bike | one merged cell | **Model over (status dot + VIN)** — same stack as the modal's Bike field (`STATUS_DOT` mirrors `BADGE_COLORS`), model `font-medium text-white`, VIN `font-mono text-brand-300` with `whitespace-nowrap`; color key row sits **above** the table, `sm:hidden`. From `sm:` up: separate Status (`Badge`) and Bike (Model over VIN) columns |
| Bike | merged with Status on phones | Model over VIN stack in both layouts — own `col-opt` column from `sm:` up (Status badge stays separate there) |
| Customer | shown | name + phone subline `text-[11px]` |
| Reserved | shown | `dateTime`, `whitespace-nowrap` |
| Paid / Total / Balance | one stacked cell | Total (default) on top, Paid (`text-emerald-300`) below it, Balance (red outstanding / emerald clear) last — same thin-hr stack as Inventory Cost/Price |
| Plan | `col-opt` | in the detail modal's Plan card |
| Down | `col-opt` | detail modal card was replaced with **Paid Amount** (sum of payment history) per developer instruction; down payment is still part of the Reserve form |
| Actions | removed entirely | no column on any breakpoint — every row opens the detail modal on click (`cursor-pointer` + row `onClick`), which serves the button's purpose; the freed width lets the Bike column expand |

Display set (Rule 0): **Model over (status-dot + VIN) merged, Customer, Reserved,
Total-over-Paid stack with Balance below**. All cells `text-xs` with `whitespace-nowrap`
so entries stay on one
line; the whole row opens the detail modal on phones (Rule 2 — Plan, Down and the
payment history are all reachable there).

---

## Verification checklist

After any table layout change, confirm:

1. `npx tsc --noEmit` in `admin/` exits 0.
2. No UTF-8 BOM was introduced in edited files. A BOM in a server-read file —
   notably `schema.sql` — breaks schema init (see the runtime guard in
   `server/src/db/index.js`). PowerShell's `[Text.Encoding]::UTF8` **adds** a
   BOM; write files with an explicit BOM-free encoding.
3. Hard-refresh the dashboard (**Ctrl+Shift+R**) — Vite serves CSS changes
   immediately, but a cached tab may keep the old stylesheet.
4. No horizontal scroll bar remains at 375 px (iPhone SE / DevTools).
5. At 768 px and up every `col-opt` column is back and the full values are shown.
6. Nothing hidden by `col-opt` is unreachable — tap a row and confirm the drawer
   contains it.

## Gotchas

- **Never hide the identifying column.** Every table must keep at least one
  column that says *what* the row is (Customer, When+User+Action, VIN, Receipt,
  …), or the mobile view becomes a list of anonymous numbers.
- **`col-opt` and the compact/full spans must use the same 640 px boundary**
  (`sm:`), or a column can be visible while its mobile-only value is hidden.
- **Don't reach for a card-layout rewrite yet.** Turning rows into stacked cards
  duplicates the markup of every table and doubles maintenance. Column-hiding
  plus a drawer has been sufficient so far; hold the card layout in reserve for
  a table where hiding columns still isn't enough.
- **`whitespace-nowrap` on a full-width value defeats the purpose** — pair it
  with the compact mobile form (Rule 3), not on its own.

---

## Pagination (PC vs. Mobile)

### The standard

All paginated admin tables use a **dual page-size** that scales with the screen:

  | Screen      | Items shown | Rationale |
  |---|---|---|
  | PC / tablet (`sm:`+) | **20** rows | A 14–16" desktop can read 20 rows comfortably; fewer paginations reduces clicks. |
  | Mobile phone (below `sm:`, i.e. < 640 px) | **10** rows | Half the viewport width means rows are longer (wrapped / stacked); 10 keeps the list scannable without thumbing past content. |

The page size is resolved **client-side at render time** from the viewport width, so it changes live as a window is resized — no reload required. The server API is unchanged; each list is fetched once (or reloaded on filter change) and the client slices it into pages.

### How it's implemented

A single shared helper decides the page size, consumed by every paginated page:

```ts
// src/lib/usePageSize.ts
import { useState, useEffect, useMemo } from 'react'

export function usePageSize() {
  const [vw, setVw] = useState<typeof window.innerWidth>(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return useMemo(() => (vw < 640 ? 10 : 20), [vw])
}
```

A page then slices the loaded records and renders standard Prev/Next controls:

```tsx
const pageSize = usePageSize()
const totalPages = Math.max(1, Math.ceil((records?.length || 0) / pageSize))
const safePage = Math.min(page, totalPages)
const pageItems = (records || []).slice((safePage - 1) * pageSize, safePage * pageSize)
// …
{records && records.length > 0 && (
  <div className="flex items-center justify-between mt-3 text-sm">
    <span className="text-slate-500">Showing {rangeFrom}–{rangeTo} of {records.length}</span>
    <div className="flex items-center gap-2">
      <button className="btn-ghost text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
      <span className="text-slate-400 text-xs">Page {safePage} of {totalPages}</span>
      <button className="btn-ghost text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
    </div>
  </div>
)}
```

### Current state (what's already paginated)

  | Page | Paginated? | Current page size | Notes |
  |---|---|---|---|
  | Sales | ✅ Yes | `usePageSize()` — 10 mobile / 20 PC | Live since this change |
  | Purchasing / Reorders | ✅ Yes | `usePageSize()` — 10 mobile / 20 PC | Both tabs share one table — pagination covers Reorder lists **and** Received consignments; page resets on tab / status-filter change |
  | Inventory | ❌ No | — | Renders all rows at once |
  | Bikes | ❌ No | — | Renders all rows at once |
  | Customers | ❌ No | — | Renders all rows at once |
  | Approvals | ❌ No | — | Renders all rows at once |
  | Audit Trail | ❌ No | — | Renders all rows at once |
  | Team & codes | ❌ No | — | Renders all rows at once |
  | Overview tables (low stock, stock value, recent sales) | ❌ No | — | Overview cards, 5–15 rows max — intentionally not paginated |

### Rollout plan

1. **~~Create `src/lib/usePageSize.ts`~~ done** — the helper lives at `src/lib/usePageSize.ts` (one file, shared by all pages).
2. **~~Sales page~~ done** — Sales uses `const pageSize = usePageSize()`; `totalPages` / `pageItems` / `rangeFrom` / `rangeTo` all derive from it.
3. **Tables with >30 rows in production** (Inventory, Bikes, Customers, Approvals, Audit, Team) — add `usePageSize()`, page-state, and the Prev/Next block. Priority order: Inventory → Customers → Approvals → Audit → Bikes → Team.
4. **Overview cards** — leave unpaginated (they show summaries capped at a small number of rows by construction).
5. **Verification checklist** — for each page:
   - Page size is **10** at 375 px (DevTools), **20** at 768 px and up.
   - Resizing the browser mid-session flips the page size and stays on a valid page (e.g. page 3 on mobile → page 2 on desktop if desktop would be empty).
   - "Showing 1–10 of 34" correctly reflects the slice; the `–` is an en-dash (Rule 3 compact form applies to numbers in all locales).
   - Prev/Next buttons disable correctly at boundaries.
   - No horizontal scroll bar on mobile (the `col-opt` + drawer standard still applies — pagination is the *vertical* companion to the *horizontal* column standard).

### Gotchas

- **The page-size breakpoint is 640 px (`sm:`), the same boundary as `col-opt`.** Keep them identical — a reader narrower than 640 px should never see 20 rows of a 5-column mobile layout.
- **Page state must reset on filter/sort change.** If a user is on page 3 and then filters to a result set that only has 1 page, land them on page 1, not an empty page (the `safePage = Math.min(page, totalPages)` guard handles this).
- **`OverviewPage` detail drawers** (sales / low-stock / etc.) are bounded lists by intent — do not paginate them. The overview itself shows a summary; the drawer shows the complete relevant set.
- **Do not push pagination to the server yet.** The API fetches full lists today; server-side paging is a future optimization once any list exceeds ~200 rows.

