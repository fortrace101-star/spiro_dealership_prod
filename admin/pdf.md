# PDF Export & Clipboard Copy — Reorder Lists

This document describes the one-click **Download PDF** pipeline and the reorder-list
**Copy** button, both surfaced in the purchasing detail modal
(`src/pages/ReordersPage.tsx`).

## What changed

Previously, "Download PDF" opened a blank browser tab, wrote a print-styled HTML
page, and fired `window.print()` — the user then had to pick "Save as PDF" in the
browser's print dialog. Both buttons now behave like this:

| Button | Behaviour | Where |
| --- | --- | --- |
| **Download PDF** | Generates a real `.pdf` file in the browser and saves it straight to **Downloads** — no print dialog, no new tab. | Reorder lists **and** received consignments |
| **Copy** | Copies a chat-friendly rendition of the list to the clipboard — **product names + quantities**, then the **number of items** and the **date**. Shows **"Copied ✓"** for ~2 seconds on success. | **Reorder lists only** |

## Files

### `src/lib/pdf.ts` (new)

The shared PDF writer every downloadable document in this app should use. Built on
[`jspdf`](https://www.npmjs.com/package/jspdf) (`^4.2.1` in `package.json`).

- **A4 portrait, millimetre units**, 14 mm margins.
- `PdfWriter(title).heading(meta)` — 16 pt bold title, wrapped grey metadata line
  (prepared-by, date, supplier, notes, "Fulfills"), separator rule. Long metadata
  wraps are page-break protected.
- `.table({ columns, rows, totals })` —
  - columns: optional fixed `width` in mm; columns without one share the
    remaining width equally; `align: 'right'` for money/quantity;
  - rows: cell text **wraps** via `splitTextToSize`, so long product names never
    overflow;
  - page breaks are automatic and the **header row repeats** on every page;
  - `totals`: bold rows drawn under a heavy rule (Total, Delivery, Landed total).
- `.save(filename?)` — stamps a footer on **every** page
  (`<title> · page n of N` left, `Generated YYYY-MM-DD` right), then downloads.
  Without an argument it falls back to `<slug-of-title>-YYYY-MM-DD.pdf`; callers
  can pass their own name (ReordersPage does — see below).

### `src/pages/ReordersPage.tsx`

- `downloadDetail(tab, d, loadedRecords)` — replaced the old `printDetail`. Same
  data (items, `(new)` tags, quantities, UGX-formatted unit/line totals,
  consignment Delivery + Landed total rows) rendered through `PdfWriter`
  instead of print HTML. Reorder-list downloads get the house filename below;
  consignments keep a title + date-stamp name.
- `reorderFilename(createdAt, counter)` — reorder lists follow the house
  standard `reorder - dd mmm - NN - yyyy.pdf`, e.g.
  `reorder - 21 Sep - 01 - 2026.pdf`: `dd mmm` and `yyyy` come from the list's
  issuance date in the shop's timezone (Africa/Kampala) and `NN` is the list's
  zero-padded sequence among that day's reorder lists.
- `dayCounter(records, target)` — computes `NN`: keeps the reorder lists issued
  on the same Kampala calendar day, orders them by creation time and returns
  the target's 1-based position ("01", "02", …). `downloadDetail` refetches the
  **unfiltered** list (`api.reorders('all')`) so the counter is right even when
  a status filter hides some of the day's lists, falling back to the loaded
  rows if the refetch fails.
- `reorderListText(d)` — builds the clipboard rendition used by the **Copy**
  button: one `Product name × qty` line per item, then the **number of items**
  and the **date** — no SKUs, values, preparer or "(new)" tags.
- `copyText(text)` — clipboard write with a legacy fallback.
  `navigator.clipboard.writeText` only exists in **secure contexts** (HTTPS /
  localhost); on a plain-HTTP LAN deployment the function transparently falls
  back to the hidden-`textarea` + `document.execCommand('copy')` technique, so
  Copy works everywhere the admin runs.
- Modal header now hosts a button group (`flex flex-wrap` so it degrades cleanly
  on phones): **Copy** (reorder tab only) + **Download PDF**, same ghost styling
  as before.

### Removed

- `src/lib/print.ts` (`printHtml` / `escapeHtml`) — the print-dialog helper this
  replaced. It had no remaining importers and was deleted.

## Output formats

### Copy (clipboard text)

Product names and quantities only, footed by the item count and the date —
deliberately **no** SKUs, **no estimated value**, no preparer, no "(new)" tags,
so it pastes cleanly into a chat:

```
Soda 500ml × 48
Cooking oil 1L × 12
Posho 5kg × 30

Items: 3
Date: 24 Sep 2026
```

### Download PDF (filename)

Reorder lists use the house standard: the literal `reorder`, the issuance date
as `dd mmm`, the list's per-day sequence number, and the issuance year,
separated by spaced hyphens. Example — the first list issued on 21 Sep 2026:

```
reorder - 21 Sep - 01 - 2026.pdf
```

`NN` counts **all** reorder lists issued that Kampala day (01, 02, 03 …), not
just those visible under the active status filter. Months use a fixed
`Jan…Dec` table rather than the locale, so the abbreviated style is identical
in every browser/OS. Received consignments keep their own title plus a short
`24 Sep - 2026` date stamp instead.

## Usage

1. Purchasing → open any reorder list (or received consignment) from the table.
2. **Copy** *(reorder lists)* → paste the item list into a chat.
3. **Download PDF** → the file lands in Downloads; send or file it.

## Verification

- `npm run build`'s typecheck gate (`tsc --noEmit`) passes with the changes.
- Copy feedback state (`copied`) auto-resets after 2 s and disables the button
  while shown, preventing duplicate copies from double-taps.
