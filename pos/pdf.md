# POS — Reorder List: Download PDF & Copy

The POS **Receive stock** modal (`pos/src/components/ReceiveSelectModal.tsx`) lists the
reorder lists that can still be fulfilled — **pending** and **processed** ones. Every
list on screen (each row in the list *and* the list opened in the detail popup) now
carries the same **Download PDF** + **Copy** pair as the admin app's reorder-list modal,
with the same behaviour, filename standard and clipboard format.

## What changed

| Button | Behaviour | Where |
| --- | --- | --- |
| **Download PDF** | Replaces the old **Print** button, which opened a print-styled window and made the user pick "Save as PDF" in the browser dialog. It now generates a real `.pdf` file in the browser and saves it straight to **Downloads** — no print dialog, no new tab. | Every reorder-list row **and** the detail popup |
| **Copy** | Copies a chat-friendly rendition of the list — **product names + quantities**, then the **number of items** and the **date**. Shows **"Copied ✓"** for ~2 seconds and is disabled while shown. | Same two places |

## Files

### `src/lib/pdf.ts` (new)

The shared PDF writer, a mirror of the admin app's `src/lib/pdf.ts` so both apps emit
identical documents. Built on [`jspdf`](https://www.npmjs.com/package/jspdf) (`^4.2.1`,
already a POS dependency — `ReceiptModal.tsx` uses it for receipt PDFs).

- **A4 portrait, millimetre units**, 14 mm margins.
- `PdfWriter(title).heading(meta)` — 16 pt bold title, wrapped grey metadata line
  (prepared-by, date, notes, supplier), separator rule; long metadata is page-break safe.
- `.table({ columns, rows, totals })` — optional fixed column widths in mm (the rest
  share the remaining width); cell text **wraps**, so long product names never overflow;
  page breaks are automatic and the **header row repeats** on every page; `totals` are
  bold rows under a heavy rule.
- `.save(filename?)` — stamps `<title> · page n of N` and `Generated YYYY-MM-DD` footers
  on **every** page, then downloads. Without an argument it falls back to
  `<slug-of-title>-YYYY-MM-DD.pdf`.

### `src/components/ReceiveSelectModal.tsx`

- `downloadList(r, loadedRecords)` — replaces the old `printList` (HTML + `window.print()`).
  Same data (items, `(new)` tags, quantities, UGX-formatted unit/line totals, and a bold
  `Total (N lines)` row) rendered through `PdfWriter` instead of print HTML.
- `reorderFilename(createdAt, counter)` — house standard `reorder - dd mmm - NN - yyyy.pdf`,
  e.g. `reorder - 21 Sep - 01 - 2026.pdf`: `dd mmm` and `yyyy` come from the list's
  issuance date in the shop's timezone (Africa/Kampala) and `NN` is the list's zero-padded
  sequence among that day's lists. Months use a fixed `Jan…Dec` table, not the locale, so
  the style is identical in every browser/OS.
- `dayCounter(records, target)` — computes `NN`: keeps the lists issued on the same
  Kampala calendar day, orders them by creation time and returns the target's 1-based
  position (`01`, `02`, …).
- `reorderListText(r)` — builds the clipboard rendition used by **Copy**: one
  `Product name × qty` line per item, then the **number of items** and the **date** — no
  SKUs, no values, no "(new)" tags.
- `copyText(text)` — clipboard write with a legacy fallback. `navigator.clipboard.writeText`
  only exists in **secure contexts**, so the hidden-`textarea` + `document.execCommand('copy')`
  path is used on a plain-HTTP LAN deployment; Copy therefore works everywhere POS runs.
- `copiedId` state — which list's Copy just succeeded, so each row shows its own
  **"Copied ✓"** feedback (auto-reset after 2 s) instead of one shared flag.
- Row buttons use `stopPropagation` so **Copy**/**Download PDF** never also open the
  list's detail popup.

### Removed

- `src/lib/print.ts` (`printHtml` / `escapeHtml`) — the print-dialog helper this replaced.
  With `ReceiveSelectModal` migrated it had no remaining importers, so it was deleted
  (same cleanup the admin app did).

## Output formats

### Copy (clipboard text)

Product names and quantities only, footed by the item count and the date — deliberately
**no** SKUs, **no** estimated value, no "(new)" tags, so it pastes cleanly into a chat:

```
Soda 500ml × 48
Cooking oil 1L × 12
Posho 5kg × 30

Items: 3
Date: 24 Sep 2026
```

### Download PDF (filename)

Reorder lists use the house standard:

```
reorder - 21 Sep - 01 - 2026.pdf
```

`NN` counts the reorder lists issued that Kampala day that the POS can see. The server's
`GET /api/purchasing/reorders` returns **active lists only** (pending + processed), which
is exactly what this modal displays, so the numbering matches the lists on screen and the
admin app's numbering for the same day.

## Usage

1. POS → **Receive stock** (or the reorder flow) → the saved reorder lists appear.
2. Tap **Copy** on a row → paste the item list into a chat/WhatsApp.
3. Tap **Download PDF** on a row (or open a list and use the buttons beside **Back**) →
   the `.pdf` lands in Downloads.
4. **Receive Stock** on the selected list fulfils it as before.

## Notes

- The PDF is generated client-side from the list payload the modal already holds, so it
  needs no extra server round-trip; the only optional request is the `api.reorders()`
  refetch used to number the file, and if it fails (offline terminal) the rows already on
  screen are used instead.
- Each line shows SKU, product (with `(new)` for first-time products), qty, unit cost and
  line total; the totals row sums `qty × unit_cost`.

## Verification

- `npx tsc --noEmit` — exit 0.
- `npx vite build` — succeeds.
- A temporary source-level check script asserted: no `lib/print` importer anywhere in
  `pos/src`; `print.ts` gone; both buttons present in **both** the row and the popup;
  the PDF built through `PdfWriter` with the 5-column table + totals and saved via
  `reorderFilename(...)`; `reorderFilename` produces
  `reorder - 21 Sep - 01 - 2026.pdf` (including the Kampala day-shift case);
  `dayCounter` ordering and fallback; and the exact clipboard text shape.

