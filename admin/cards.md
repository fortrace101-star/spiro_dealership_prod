# Dashboard Card & Layout Reference

This document records the mobile-responsive layout adjustments made to the admin
dashboard's Overview page and the shared UI components they rely on. It serves as
the reference for how the top KPI cards, the alert/action cards, and their
typography are sized across screen sizes.

---

## 1. KPI cards — 2×2 grid (all screen sizes)

**File:** `src/pages/OverviewPage.tsx`

The four top summary cards (Revenue, Gross Profit, Bikes Sold, Avg Transaction)
were originally a single row of four (`lg:grid-cols-4`). They now render in a
**2 × 2 grid at every breakpoint** — two cards side by side, two below — on
desktop *and* mobile:

```tsx
<div className="grid grid-cols-2 gap-4">
  <KpiCard label="Revenue" … />
  <KpiCard label="Gross profit" … accent />
  <KpiCard label="Bikes sold" … />
  <KpiCard label="Avg transaction" … />
</div>
```

- `grid-cols-2` (no `sm:`/`lg:` prefixes) — deliberately **not** responsive, so
  the 2×2 layout holds on phones, tablets, and desktops alike.
- `gap-4` keeps consistent gutters between the four cards.

## 2. Alert / action cards — 2×2 grid (all screen sizes)

**File:** `src/pages/OverviewPage.tsx`

The four colored action buttons (Low stock, Pending approvals, Credit
outstanding, etc.) previously stacked in a single column of four. They now use
the same **2 × 2 grid**, matching the KPI cards above them:

```tsx
<div className="grid grid-cols-2 gap-4">
  <AlertCard … />  {/* low stock */}
  <AlertCard … />  {/* pending approvals */}
  <AlertCard … />  {/* credit outstanding */}
  <AlertCard … />  {/* … */}
</div>
```

## 3. Card components — responsive internals

**File:** `src/components/ui.tsx`

Because each card is now only half the viewport width, the internals scale down
on phones and return to their original size from the `sm:` breakpoint (640 px)
up:

| Element | Mobile | `sm:` and up |
|---|---|---|
| `KpiCard` padding | `p-4` | `p-5` |
| `KpiCard` value (accent cards) | `text-lg` | `text-2xl` |
| `KpiCard` value (plain) | `text-lg` | `text-lg` |
| `KpiCard` delta line | `text-[11px]` | `text-xs` |
| `KpiCard` "Click for details →" hint | **hidden** (`hidden sm:block`) | shown |
| `AlertCard` padding | `p-3` | `p-4` |
| `AlertCard` value | `text-lg` | `text-xl` |

Notes:

- All numeric values use `tabular-nums` so multi-digit UGX figures align cleanly
  in the half-width cards.
- The "Click for details →" affordance is pointer-specific, so it is suppressed
  on mobile (touch) to avoid cluttering the smaller cards.
- `AlertCard` values that contain long strings (e.g. `UGX 12,500,000` credit
  outstanding) fit in half-width without overflowing thanks to the smaller
  mobile step.

## 4. Global typography — responsive pass

**Files:** `src/index.css`, `src/pages/InventoryPage.tsx`

### Tables (`.th` / `.td` in `index.css`)

Applies to **every table** in the admin app (Purchasing, Inventory, Sales,
Approvals, Audit, …):

| Element | Mobile | `sm:` and up |
|---|---|---|
| `.th` header text | `text-[10px]` | `text-[11px]` |
| `.th` padding | `px-3 py-2.5` | `px-4 py-3` |
| `.td` cell text | `text-[13px]` | `text-sm` |
| `.td` padding | `px-3 py-2.5` | `px-4 py-3` |

### Headings and modals

| Element | Mobile | `sm:` and up |
|---|---|---|
| `PageHeader` title (`ui.tsx`) | `text-lg` | `text-2xl` |
| Modal title (`InventoryPage.tsx`) | `text-base` | `text-lg` |
| "Stock movements" panel heading (`InventoryPage.tsx`) | `text-sm` | `text-base` |

### Already responsive (no change needed)

- `.input` — `text-base sm:text-sm`: 16 px on mobile, which prevents iOS Safari's
  automatic zoom-on-focus.
- `.btn` — `text-sm` with `min-h-[40px]`, keeping an adequate touch target.
- `PageHeader` stacks vertically (`flex-col`) on mobile and switches to a row
  with actions right-aligned from `sm:` up.

---

## Verification checklist

After layout changes, confirm:

1. `npx tsc --noEmit` in `admin/` exits 0.
2. No UTF-8 BOM was introduced in edited files (a BOM in any server-read file —
   notably `schema.sql` — breaks schema init; see `server/src/db/index.js` for
   the runtime guard).
3. Hard-refresh the dashboard (**Ctrl+Shift+R**) — Vite serves CSS changes
   immediately, but a cached tab may keep the old stylesheet.
4. On desktop the 2×2 grids replace the old four-across row by design; this is
   intentional, not a regression.
