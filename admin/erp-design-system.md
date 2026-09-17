# ERP Typography & Layout Style Guide

A reference design system for building an ERP frontend consistently across modules (e.g. Subscriptions/Billing, CRM, Accounting, Inventory, Orders, Customer tracking). Built for React + Vite + TypeScript, intended to pair with Tailwind CSS (or CSS variables if not using Tailwind).

---

## 1. Font Family

Use a neutral, highly legible sans-serif — avoid serif fonts, they slow down scanning of tables and numbers.

**Recommended:** [Inter](https://fonts.google.com/specimen/Inter) — free, has a tabular-number variant, widely used in modern SaaS/ERP tools.

```css
:root {
  --font-sans: 'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  --font-mono: 'Inter', ui-monospace, monospace; /* for aligned numeric columns, use font-variant-numeric: tabular-nums */
}

body {
  font-family: var(--font-sans);
}
```

If using Tailwind, set this in `tailwind.config.js`:

```js
theme: {
  extend: {
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
  },
}
```

---

## 2. Type Scale

| Token | Size | Weight | Use case |
|---|---|---|---|
| `text-xs` | 11px | 400 | Table meta, timestamps, helper text |
| `text-sm` | 12px | 400 | Labels, secondary text |
| `text-base` | 13–14px | 400 | Body text, table cell content |
| `text-md` | 15px | 500 | Emphasized body / active row text |
| `text-lg` | 16–18px | 600 | Section headers (e.g. "Inventory" card title) |
| `text-xl` | 20–24px | 600 | Page titles (e.g. "Orders Dashboard") |
| `text-total` | 14–16px | 600–700 | Totals, invoice amounts, key financial figures |

**Line height:** 1.3–1.5x across the board — screens stay dense with rows, so avoid airy spacing.

**Numeric alignment:** apply `font-variant-numeric: tabular-nums;` to any column of numbers (prices, quantities, invoice totals) so digits align vertically.

---

## 3. Font Weights

| Weight | Value | Use |
|---|---|---|
| Regular | 400 | Body copy, table content |
| Medium | 500 | Field labels, nav items, active tab |
| Semibold | 600 | Headers, section titles, totals |
| Bold | 700 | Reserved — alerts, overdue amounts, critical flags only |

Avoid overusing bold; in dense ERP screens it should signal something specific (e.g., an overdue invoice), not general emphasis.

---

## 4. Spacing Grid

Use an 8px base unit for all padding/margin — keeps every module visually consistent even when built by different components/screens.

| Token | Value |
|---|---|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 16px |
| `space-4` | 24px |
| `space-5` | 32px |

---

## 5. Layout Structure

```
┌─────────────────────────────────────────────┐
│ Top bar: search · notifications · org/tenant │
│ switcher · user menu                         │
├───────────┬───────────────────────────────────┤
│           │                                   │
│ Sidebar   │  Content area                     │
│ (nav):    │  - Page title (text-xl)           │
│ Orders    │  - Filters/toolbar row             │
│ Inventory │  - Data table (sticky header,      │
│ CRM       │    sortable columns, zebra rows    │
│ Accounting│    optional)                       │
│ Billing   │  - Right-aligned numeric columns   │
│ (collaps- │  - Status badges (color-coded)     │
│ ible)     │                                   │
└───────────┴───────────────────────────────────┘
```

**Key conventions:**
- Left sidebar for module navigation (admin/employee roles can hide/show modules based on permissions).
- Data tables are the default content pattern — not cards — for Orders, Inventory, Accounting.
- CRM/messaging modules can break this pattern with a chat-style two-pane layout (contact list + conversation).
- Forms: label above input, grouped into tabs for multi-part records (e.g. a Customer record: Details / Orders / Payments / Notes).
- Sticky table headers on any list expected to scroll (orders, inventory, transactions).

---

## 6. Color & Status (functional, not decorative)

Keep the base palette low-saturation (grays + one brand accent). Reserve color for status meaning:

| Status | Color |
|---|---|
| Paid / Completed / In stock | Green |
| Pending / Low stock | Yellow/Amber |
| Overdue / Out of stock / Error | Red |
| Draft / Inactive | Gray |
| Active / Selected | Brand accent (pick one primary color for your product) |

Status should be shown as a small colored badge/tag next to text, not by coloring the text itself — keeps tables scannable.

---

## 7. Component Notes for React + TS

- Centralize these tokens in a `theme.ts` or Tailwind config so every module (Billing, CRM, Inventory, etc.) pulls from the same source — avoids drift as different features get built over time.
- Build a shared `<DataTable>` component (sortable, sticky header, right-aligned numeric columns via a `align="right"` column prop) once, and reuse it across Orders, Inventory, Accounting rather than rebuilding tables per module.
- Build a shared `<StatusBadge status="paid" | "pending" | "overdue" | ... />` component early — it'll get used constantly across Billing, Orders, and Inventory.

---

*This is a starting reference — adjust the brand accent color and exact scale once you have branding assets, but keep the spacing/type conventions consistent across modules so the ERP doesn't feel stitched together from different screens.*
