/** Minimal print/PDF helper: opens a print-styled window; the browser's print
 * dialog saves it as PDF. Shared by every printable document in this app. */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
}

export function printHtml(title: string, bodyHtml: string): void {
  const w = window.open('', '_blank', 'width=820,height=920')
  if (!w) return
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 600; border-top: 2px solid #0f172a; border-bottom: none; }
  @media print { body { margin: 12mm; } }
</style></head><body>${bodyHtml}<script>setTimeout(function(){window.print()},200)</script></body></html>`,
  )
  w.document.close()
}
