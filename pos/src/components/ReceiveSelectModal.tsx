import { useEffect, useState } from 'react'
import { api, type PurchasingRecord } from '../lib/api'
import { ugx, dateTime } from '../lib/format'
import { printHtml, escapeHtml } from '../lib/print'

/** Renders the selected reorder list into a printable PDF document. */
function printList(r: PurchasingRecord): void {
  const rows = r.items
    .map((i, idx) => {
      const unit = Number(i.unit_cost) || 0
      const isNew = (i as { new_product?: unknown }).new_product
      return `<tr><td>${escapeHtml(i.sku || '')}</td><td>${escapeHtml(i.name || '')}${isNew ? ' <em>(new)</em>' : ''}</td><td class="num">${i.qty}</td><td class="num">${unit ? ugx(unit) : ''}</td><td class="num">${ugx(i.qty * unit)}</td></tr>`
    })
    .join('')
  const totalQty = r.items.reduce((s, i) => s + i.qty, 0)
  const title = r.title || r.reference || 'Reorder list'
  printHtml(
    title,
    `<h1>${escapeHtml(title)}</h1>
<div class="meta">Reorder list${r.status ? ` · ${escapeHtml(r.status)}` : ''}${r.supplier ? ` · Supplier: ${escapeHtml(r.supplier)}` : ''} · created ${escapeHtml(dateTime(r.created_at))}${r.notes ? ` · ${escapeHtml(r.notes)}` : ''}</div>
<table><thead><tr><th>SKU</th><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line total</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="2">Total (${r.items.length} line${r.items.length === 1 ? '' : 's'}, qty ${totalQty})</td><td colspan="3" class="num">${r.items_total != null ? ugx(r.items_total) : ''}</td></tr></tfoot></table>`,
  )
}

interface Props {
  onClose: () => void
  onSelect: (record: PurchasingRecord) => void
  onNew: () => void
}

/** Lifecycle badge: pending (blue) -> processed (theme light green) -> fulfilled (muted) / cancelled (red). */
function StatusBadge({ status }: { status?: string }) {
  const s = status || 'pending'
  const styles: Record<string, string> = {
    pending: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    processed: 'bg-brand-500/15 text-brand-300 border-brand-500/40',
    fulfilled: 'bg-slate-500/15 text-slate-400 border-slate-600/50',
    cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
  }
  const labels: Record<string, string> = {
    pending: 'Pending',
    processed: 'Processed',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
  }
  return (
    <span
      className={
        'inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ' +
        (styles[s] || styles.pending)
      }
    >
      {labels[s] || s}
    </span>
  )
}

/** Shows saved reorder lists ready to receive against. Pick one to fulfill, or start a new restock. */
export default function ReceiveSelectModal({ onClose, onSelect, onNew }: Props) {
  const [reorders, setReorders] = useState<PurchasingRecord[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PurchasingRecord | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const r = await api.reorders()
        setReorders(r.records)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load reorder lists')
      }
      setLoading(false)
    })()
  }, [])

  // Only lists that can still be fulfilled: pending or processed.
  // Fulfilled lists are hidden here — their stock has already been received.
  const lists = (reorders || []).filter((r) => r.status === 'pending' || r.status === 'processed' || !r.status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold text-white text-lg">Receive stock</h2>
            <p className="text-sm text-slate-500 mt-0.5">Select a reorder list to fulfill, or start a new restock.</p>
          </div>
          <button className="text-slate-500 hover:text-white" onClick={onClose}>×</button>
        </div>

        {loading && <div className="text-sm text-slate-600 py-8 text-center">Loading…</div>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && (
          <div className="space-y-2">
            {lists.length === 0 ? (
              <p className="text-sm text-slate-600">No saved reorder lists.</p>
            ) : (
              lists.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className="w-full text-left card p-4 hover:border-brand-500/50 transition cursor-pointer"
                  onClick={() => setSelected(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelected(r) }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{r.title || r.reference || 'Reorder list'}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {r.items.length} item{r.items.length !== 1 ? 's' : ''} · created {dateTime(r.created_at)}
                  </div>
                  {r.supplier && <div className="text-xs text-slate-500 mt-0.5">Supplier: {r.supplier}</div>}
                  {r.items_total != null && <div className="text-xs text-slate-500 mt-0.5">Est. value: {ugx(r.items_total)}</div>}
                  <div className="flex justify-end mt-2">
                    <button
                      className="btn-ghost text-xs"
                      onClick={(e) => { e.stopPropagation(); printList(r) }}
                      title="Print or save this list as PDF"
                    >
                      Print
                    </button>
                  </div>
                </div>
              ))
            )}

            <button
              className="w-full text-left card p-4 border-dashed border-slate-700 hover:border-brand-500/50 transition mt-3"
              onClick={onNew}
            >
              <div className="font-medium text-white">+ Start a new restock</div>
              <div className="text-xs text-slate-500 mt-0.5">Create a new list of products being received (not tied to an existing reorder list).</div>
            </button>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Detail popup layered above the list: shows the full list before fulfilling. */}
      {selected && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative card w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-white">{selected.title || selected.reference || 'Reorder list'}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selected.items.length} item{selected.items.length !== 1 ? 's' : ''} · created {dateTime(selected.created_at)}
                </p>
              </div>
              <button className="text-slate-500 hover:text-white" onClick={() => setSelected(null)}>×</button>
            </div>

            {selected.supplier && <div className="text-xs text-slate-500 mb-1">Supplier: {selected.supplier}</div>}
            {selected.notes && <div className="text-xs text-slate-500 mb-2">Notes: {selected.notes}</div>}

            <div className="space-y-1.5 mt-2">
              {selected.items.map((i, idx) => (
                <div key={i.product_id || `n${idx}`} className="flex items-center justify-between gap-2 text-sm border border-slate-800 rounded-lg px-2.5 py-2">
                  <span className="min-w-0 truncate text-slate-200">
                    <span className="font-mono text-xs text-slate-500">{i.sku}</span> {i.name}
                  </span>
                  <span className="text-slate-300 shrink-0">
                    ×{i.qty}{i.unit_cost ? ` · ${ugx(Number(i.unit_cost) || 0)}` : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-between text-xs text-slate-500 mt-3">
              <span>Total qty: {selected.items.reduce((s, i) => s + i.qty, 0)}</span>
              {selected.items_total != null && <span>Est. value: {ugx(selected.items_total)}</span>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800">
              <StatusBadge status={selected.status} />
              <div className="flex justify-end gap-2">
                <button
                  className="btn-ghost"
                  onClick={() => printList(selected)}
                  title="Print or save this list as PDF"
                >
                  Print
                </button>
                <button className="btn-ghost" onClick={() => setSelected(null)}>Back</button>
                <button className="btn-primary" onClick={() => onSelect(selected)}>Receive Stock</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

