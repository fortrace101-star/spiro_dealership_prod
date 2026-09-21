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

```tsx
<td className="td text-right font-semibold text-white tabular-nums whitespace-nowrap">
  <span className="sm:hidden">{compactUgx(c.lifetime_value)}</span>
  <span className="hidden sm:inline">{ugx(c.lifetime_value)}</span>
</td>
```

Helpers live in `src/lib/format.ts`: `ugx`, `compactUgx`, `num`, `dateTime`,
`dateOnly`, `timeAgo`. Add a compact helper there rather than inlining logic.

### Rule 4 — One primary cell, one muted subline

The identifying cell carries `font-medium text-white`; any secondary line inside
the same cell is `text-[11px] text-slate-500`.

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
| Inventory (main, 8 cols) | Product, Price, Stock, Status + actions | Category, Cost, Margin |
| Sales (main, 7 cols) | Receipt, Date, Total | Cashier, Customer, Payment, Profit |
| Sales (items sub-table) | all — already fits | — |
| Purchasing (item table inside the modal) | SKU, Product, Qty, Line total | Unit cost |
| Bikes (7 cols) | VIN, Model, Status | Battery, Cost, Price, Customer |
| Approvals (5 + action) | Type, Request, Status + actions | Requested by, When |
| Team & codes (4 cols) | all four | Expires, only if it still overflows |
| Settings (staff, 5 cols) | Name, Revenue | Sales, Profit, Discounts |
| Overview (low stock, 3 cols) | all three | — |
| Overview (stock value, 5 cols) | Product, In stock, Stock value | Min, Reorder at |
| Overview (recent sales, 5 cols) | Receipt, When, Total | Customer, Status/Method |
| Customers | ✅ done | Location, Purchases |
| Audit Trail | ✅ done | Entity, Changes |
| Purchasing (Received consignments / Reorder lists) | ✅ done | Items, Supplier, Delivery, Prepared by |

**Sales note:** the main Sales table has no per-sale drawer equivalent to
Customers/Audit. Before hiding Cashier / Customer / Payment / Profit there,
either confirm the row opens a sale detail view, or leave those columns visible
until one exists.

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
