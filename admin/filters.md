# Filter cards — the standard

This document records the responsive filter-card pattern applied to the **Sales**
and **Bikes** pages, and the decisions behind each adjustment. Both cards are
built from the same primitives, so they behave identically at every width.

---

## The card structure (two rows)

```
┌──────────────────────────────────────────────────────────┐
│ PICK PERIOD                PAYMENT TYPE                  │  ← Row 1
│ [ dropdown            ]   [ dropdown       ]             │
│                                                          │
│ [search………………………………………] [Search]                        │  ← Row 2
│ N transactions                                           │  ← count
└──────────────────────────────────────────────────────────┘
```

**Row 1 — pickers, side by side.** Each picker sits in a titled `Field`
("Pick period" / "Payment type" / "Status") inside a `flex-1` wrapper
(`min-w-[150px]` / `min-w-[130px]`), so they share the width equally and wrap
only when a screen is too narrow for both.

**Row 2 — search + button.** A real `<form>`: the search input fills all
remaining space (`flex-1 min-w-0`) with the **Search** button pinned at the
right-most edge (`btn-primary text-xs px-5`). Submitting (button click or
**Enter**) re-runs the query; live type-to-filter still works as before.

**Count line.** The result count ("N transactions" / "N bikes") sits **below
the search field** with the same `mt-3` (12px) vertical rhythm the card uses
between its rows — styled `text-xs text-slate-500`. (An early version put it at
the row's right edge and a `space-y-1` wrapper silently overrode its margin;
both are fixed — the wrapper was removed and the `mt-3` applies reliably.)

---

## Mobile-responsiveness rules

| Element | Phone (<640px) | PC (`sm:` and up) |
|---|---|---|
| Picker/select/input text | `text-[13px]` | `text-sm` (14px) |
| Search placeholder | `Search…` | full hint (e.g. `Search receipt, cashier, customer…`) |
| Period option labels | short (`3 days`, `Week`, `45d`) | full (`Past 3 days`, `This week`, `Last 45 days`) |
| Status "all" option (Bikes) | `All` | `All statuses` |

- The 640px boundary is Tailwind's `sm:` — the same boundary `col-opt`,
  `usePageSize` and the compact table forms use, so all responsive behavior
  agrees.
- Live viewport detection uses the shared `useIsPhone()` hook
  (`src/lib/usePageSize.ts`), which reacts to resizes without a reload.
- Selects carry `truncate` so a long active label can never push the control
  wider.
- The 13px phone size is a deliberate trade-off: 16px is what prevents iOS
  Safari from auto-zooming into inputs on focus, so tapping a filter on a real
  iPhone may zoom slightly.

---

## Sales page specifics (`src/pages/SalesPage.tsx`)

**Period picker → single dropdown.** The original preset-chip button row was
replaced by one `<select>` (`PeriodPicker variant="select"`, in
`src/components/PeriodPicker.tsx`) holding all eight presets plus a final
**Custom…** entry:

- Choosing any preset applies the filter immediately.
- **Custom is the exception:** selecting it only reveals the custom-range
  panel; **Apply** commits the range. While a custom range is active, the
  dropdown shows its actual label ("Last 45 days" / "Custom range", compact
  forms on phones) instead of "Custom…".
- The custom panel spans the **full card width** (not just the period column)
  and is laid out as: the Last-N-days field on the left (sized to exactly the
  Period picker column's width, `calc(50% - 6px)`), a plain inline **or** on PC
  / an `hr`-into-circle divider on mobile, then the **From / To / Apply** group
  (From + To + Apply always share one line; From/To are 115px on phones, 135px
  on PC). The Apply button matches the Search button exactly
  (`btn-primary text-xs px-5`), and the From/To/Apply group is nudged left
  (`sm:-translate-x-6`) to balance the row.
- The panel has **no border** (`bg-[#12161d] rounded-2xl` only) — the `card`
  class border was removed on request.
- The **Settings page still uses the button-chip variant** (`variant="buttons"`,
  the default) — untouched.

**Payment picker.** A plain `<select>` of `PAYMENT_LABELS` with "All payments"
as the default — same titled, compact treatment as the period picker.

---

## Bikes page specifics (`src/pages/BikesPage.tsx`)

The Bikes filter card was rebuilt to mirror the Sales card exactly:

- **Row 1:** a single titled **Status** dropdown (`flex-1 min-w-[150px]`) —
  All / In stock / Reserved / Sold, with the short "All" label on phones and
  compact 13px text; the `flex-1` wrapper leaves room for a second picker if
  one is ever added.
- **Row 2:** search (`flex-1 min-w-0`, short placeholder on phones) + the
  standard **Search** button at the right edge; **"N bikes"** count below the
  search with the same `mt-3` rhythm.
- The VIN 360 lookup card above the filter card keeps its long placeholder at
  all sizes (it truncates natively inside the input).

---

## Gotchas

- **Put the width on a wrapper, not the input, when inside a `Field`.** `Field`
  renders a bare `<label class="block">`; as a flex item it is sized to its
  content, so percentage widths on the inner input resolve against nothing.
  Wrap the Field in a sized `<div>` and make the input `w-full` (this bit the
  Last-N-days width in the Sales custom panel).
- **Tailwind arbitrary values need underscores in calc** —
  `-mr-[calc(100%_+_12px)]`, not `-mr-[calc(100%+12px)]` (spaces are stripped
  and the rule never emits).
- **A parent `space-y-*` can override a child's `mt-*`** (the child-selector
  rule wins) — remove the wrapper's spacing class if a child needs its own
  margin.
- **Verify with `npx tsc --noEmit`** after touching these files, and
  hard-refresh (**Ctrl+Shift+R**) — Vite serves CSS/JSX changes immediately but
  a cached tab may keep the old build.
