# Filter cards — Sales & Bikes (mobile-responsive standard)

**Files:** `src/pages/SalesPage.tsx`, `src/pages/BikesPage.tsx`
**Shared helpers:** `src/components/PeriodPicker.tsx` (select variant),
`src/lib/usePageSize.ts` (`useIsPhone()`), `src/lib/periods.ts` (short labels)

Both pages' filter cards follow the same restructured, mobile-responsive layout.
This document records what was changed and why, so future pages can copy the
pattern (the next candidate is any page still using the old chip-row filter).

---

## The standard layout (two rows)

```
PICK PERIOD            PAYMENT TYPE / STATUS
[ dropdown       ]     [ dropdown    ]
[ search……………………………] [Search]   ← button at the right-most edge
N transactions                       ← count, one rhythm-step below
```

1. **Row 1 — pickers side by side.** Each picker sits in a titled `Field`
   ("Pick period" / "Payment type" on Sales; "Status" on Bikes) inside a
   `flex-1` wrapper so both share the row equally. They wrap only if a screen
   is too narrow for both.
2. **Row 2 — search + button.** The search input **fills all remaining space**
   (`flex-1 min-w-0`) with the **"Search" button pinned to the right edge**
   (`btn-primary text-xs px-5`). It is a real `<form>`: click or **Enter**
   re-runs the query, while live type-to-filter still works.
3. **Count line below.** The result count ("N transactions" / "N bikes") sits
   directly under the search field with `mt-3` — the same 12px rhythm step that
   separates the two rows (`space-y-3`). Note: any `space-y-*` on a wrapping
   column overrides a child's `mt-*` (child-selector specificity), so keep the
   count in the same flex column as the search, not inside a spaced wrapper.

---

## Text sizing rules

| Element | Phone (<640px) | PC (≥640px) |
|---|---|---|
| Pickers, search input | `text-[13px]` | `text-sm` (16px base inputs felt disproportionate) |
| Search button | `text-xs` | `text-xs` |
| Result count | `text-xs text-slate-500` | same |
| Search placeholder | short — "Search…" | full — "Search receipt, cashier, customer…" (Sales) / "Search VIN, model, motor…" (Bikes) |

- The placeholder swap uses `useIsPhone()` from `src/lib/usePageSize.ts`
  (live-resizing, same 640px boundary as `col-opt`).
- ⚠️ **iOS zoom caveat:** 16px is what stops iOS Safari from auto-zooming into
  inputs on focus. The 13px inputs mean iOS may zoom when tapping the search
  field. Accepted trade-off; bump a specific input back to 16px if it bothers
  on-device use.

---

## Period picker — Sales (single dropdown)

`<PeriodPicker variant="select" />` replaced the preset chip-row:

- **One `<select>`** lists all 8 presets (Today, Past 3 days, This week,
  Past 2 weeks, This month, This quarter, This half, This year) plus a final
  **"Custom…"** entry — everything except Custom lives in the one dropdown.
- **Custom is the exception:** choosing "Custom…" doesn't apply anything; it
  reveals the inline panel (Last N days / From–To / Apply). While a custom
  range is active the dropdown shows its actual label ("Last 45 days" /
  "Custom range").
- **Compact labels on phones:** presets carry a `short` label in
  `src/lib/periods.ts` ("3 days", "Week", "2 weeks", "Month", "Quarter",
  "Half", "Year"); the dropdown shows short text below 640px, full text above.
  A custom day-count reads "45d" / "Custom" on phones.
- **Custom panel layout** (spans the full card width via a negative right
  margin, so it starts at the same left edge as the picker above it):
  - **PC:** one line — `Last N days  or  From  To  [Apply]`, with the plain
    word "or" and auto margins balancing the gaps on either side of it; the
    From/To/Apply group is nudged left (`sm:-translate-x-6`) for visual
    balance. From/To inputs are `w-[115px] sm:w-[135px]`.
  - **Mobile:** stacked — Last N Days full column width
    (`w-[calc(50%_-_6px)]`, matching the picker column above), then an
    **hr-and-circle divider** (rules converging into a circular badge
    containing "or", centered on the card), then From / To / **Apply** grouped
    on one line. Apply is `btn-primary text-xs px-5` — same size as Search.
- **Titles above the pickers:** "Pick period" and "Payment type" (`Field`
  labels), matching the Bikes "Status" title.
- **Border removed** from the custom panel — background only, no `card` border.
- The **Settings page still uses the default button-chip variant** of
  `PeriodPicker` — untouched by all of this (the `variant="buttons"` default
  path is unchanged).

## Bikes status picker

The Bikes "All statuses" filter received the same treatment: titled `Field`
("Status"), a single `<select>`, `text-[13px]` on phones / `text-sm` on PC,
`truncate`, and a short "All" option label on phones.

---

## Reservations / Installments (Bikes page tab) — standard applied

**Files:** `src/pages/ReservationModals.tsx` (admin `ReservationsTabContent`), `pos/src/components\ReservationsModal.tsx` (`ListPane`)

Both the admin tab's filter card and the POS reservations `ListPane` show a single status filter with a search bar. They received the same treatment as Sales/Bikes:

- **Admin tab (`ReservationModals.tsx`):** `ReservationsTabContent` already matched the standard (titled `Field` "Status" + search/fill + Search button + count below the search). Verified — untouched.
- **POS `ListPane`:** the old `ListPane` used a plain `<label>` + `<select>` + a row of chip buttons (not a titled `Field`, no Search button). Replaced it with the same two-row structure every other screen uses:
  - **Row 1:** titled `Field` ("Status"), a single `<select>` with **`text-[13px] sm:text-sm`** and `truncate`, short **"All"** option label on phones (`phone ? 'All' : 'All statuses'`).
  - **Row 2:** search input that **fills all remaining space** (`flex-1 min-w-0`) with a **"Search" button pinned to the right edge** (`btn-primary text-xs px-5`). The form fires on click or Enter; live type-to-filter still works.
  - **Count below:** `{N} reservations` sits one `mt-3` step under the search field — same rhythm as the count lines everywhere else.
  - **`+ New reservation`** keeps its own row below the card (nominated action, not squashed into the filter row), matching the admin `+ Reserve bike` spin-off.
- **Options list (shared between POS and admin):** All / Active / Completed / Released / Expired. The old POS `ListPane` only exposed Active / Completed / Released (the SQLite side supports `expired` too — see `reservations.js`), so both versions now expose the same 5 options and can be unified if there's ever a reason.
- **Compact text on mobile:** same as the rest of the app — pickers/search at `text-[13px]` on phones / `text-sm` on PC, Search button `text-xs`, same short `"Search…"` placeholder on phones via `useIsPhone()` / full `"Search VIN, model, customer…"` on PC.
- **POS is a React Shell popup** (not the dashboard page), so the same live-resize behavior applies inside the shell — Status and search placeholders swap and text sizes switch at the 640px boundary the same way they do on the dashboard filter cards.

---

- **Tailwind arbitrary calc needs underscores:** `-mr-[calc(100%+12px)]`
  silently generates nothing (spaces required around `+`); the working form is
  `-mr-[calc(100%_+_12px)]`. An invalid arbitrary value fails silently —
  always confirm the CSS actually landed.
- **A bare `Field` label is content-sized** (it's a `<label class="block">`).
  To make an input inside it match another column's width, wrap the Field in a
  div with a definite width (`w-[calc(50%_-_6px)]`) and make the input
  `w-full` — the input's percentage resolves against the wrapper, not the
  content.
- **`space-y-*` beats a child's `mt-*`** on the same element (specificity) —
  keep spacing either on the parent or the child, not both.
- **Breakpoint agreement:** pickers, `col-opt`, `usePageSize`, and
  `useIsPhone` all share the 640px (`sm:`) boundary so text swapping, column
  hiding and page sizing always agree.
