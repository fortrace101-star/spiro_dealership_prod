import { useEffect, useState } from 'react'
import { api, type PurchasingRecord } from '../lib/api'
import { dateOnly, dateTime, ugx } from '../lib/format'
import { PdfWriter } from '../lib/pdf'

/** Renders a displayed reorder list into a real PDF file and saves it straight
 *  to Downloads - one click, no print dialog, no new tab (lib/pdf.ts pipeline,
 *  the same writer the admin app uses). */
async function downloadList(r: PurchasingRecord, loadedRecords: PurchasingRecord[]): Promise<void> {
  const title = r.title || r.reference || 'Reorder list'
  const meta = [
    'Reorder list',
    `prepared by ${r.created_by_name || '—'}`,
    dateTime(r.created_at),
    r.notes ? `Notes: ${r.notes}` : '',
    r.supplier ? `Supplier: ${r.supplier}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const rows = r.items.map((i) => {
    const unit = Number(i.unit_cost) || 0
    const qty = Number(i.qty) || 0
    return [i.sku || '', `${i.name || ''}${i.new_product ? ' (new)' : ''}`, String(qty), ugx(unit), ugx(qty * unit)]
  })

  const value = r.items.reduce((s, i) => s + Number(i.qty) * (Number(i.unit_cost) || 0), 0)
  const totals: string[][] = [[`Total (${r.items.length} line${r.items.length === 1 ? '' : 's'})`, '', '', '', ugx(value)]]

  // The house filename needs this list's sequence among every reorder list
  // issued that Kampala day, so refetch the full list first and fall back to the
  // rows already on screen when that request fails (offline terminal).
  let dayRecords = loadedRecords
  try {
    dayRecords = (await api.reorders()).records
  } catch {
    /* offline: the loaded rows still produce a valid sequence number */
  }

  new PdfWriter(title)
    .heading(meta)
    .table({
      columns: [
        { label: 'SKU', width: 26 },
        { label: 'Product' },
        { label: 'Qty', align: 'right', width: 16 },
        { label: 'Unit cost', align: 'right', width: 42 },
        { label: 'Line total', align: 'right', width: 42 },
      ],
      rows,
      totals,
    })
    .save(reorderFilename(r.created_at, dayCounter(dayRecords, r)))
}

/** Calendar parts (day/month/year) of a timestamp in the shop's timezone
 *  (Africa/Kampala); defaults to now when the timestamp is missing. */
function kampalaParts(iso: string | null | undefined): { day: string; month: string; year: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'numeric', year: 'numeric', timeZone: 'Africa/Kampala',
  }).formatToParts(iso ? new Date(iso) : new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return { day: get('day'), month: get('month'), year: get('year') }
}

// Fixed month table (not the locale) so abbreviations match in every browser/OS.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** House standard for reorder-list downloads:
 *  "reorder - 21 Sep - 01 - 2026.pdf" - dd mmm from the issuance date, NN the
 *  1-based sequence of the list among that Kampala day's reorder lists, yyyy
 *  the issuance year (identical to the admin app's filename). */
function reorderFilename(createdAt: string | null | undefined, counter: string): string {
  const { day, month, year } = kampalaParts(createdAt)
  return `reorder - ${day} ${MONTHS[Number(month) - 1]} - ${counter} - ${year}.pdf`
}

/** 1-based, zero-padded sequence of `target` among the reorder lists issued on
 *  the same Kampala calendar day, ordered by creation time ("01", "02", ...). */
function dayCounter(records: PurchasingRecord[], target: PurchasingRecord): string {
  const key = (iso: string) => {
    const p = kampalaParts(iso)
    return `${p.year}-${p.month}-${p.day}`
  }
  const sameDay = records
    .filter((r) => key(r.created_at) === key(target.created_at))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const idx = sameDay.findIndex((r) => r.id === target.id)
  // The modal always opens from a loaded row, so a missing id shouldn't happen;
  // treat it as the next slot so the file still gets a valid number.
  return String((idx === -1 ? sameDay.length : idx) + 1).padStart(2, '0')
}

/** Builds the chat-friendly clipboard rendition for the Copy button: product
 *  names and quantities only, footed by the item count and the list's date -
 *  no SKUs, no values, so it pastes cleanly into a chat. */
function reorderListText(r: PurchasingRecord): string {
  const lines = r.items.map((i) => `${i.name || ''} × ${(Number(i.qty) || 0).toLocaleString('en-UG')}`)
  return [...lines, '', `Items: ${r.items.length}`, `Date: ${dateOnly(r.created_at)}`].join('\n')
}

/** Clipboard write with a legacy fallback: navigator.clipboard only exists in
 *  secure contexts, so a plain-HTTP LAN deployment goes through execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
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
  // Id of the list whose Copy just succeeded, so each row shows its own
  // "Copied ✓" feedback and the button can't be double-fired.
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      className="btn-ghost text-xs"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const id = r.id
                        if (await copyText(reorderListText(r))) {
                          setCopiedId(id)
                          window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000)
                        }
                      }}
                      disabled={copiedId === r.id}
                      title="Copy the item list for pasting into a chat"
                    >
                      {copiedId === r.id ? 'Copied ✓' : 'Copy'}
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      onClick={(e) => { e.stopPropagation(); void downloadList(r, reorders || []) }}
                      title="Download this list as a PDF file"
                    >
                      Download PDF
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
                {/* Copy is list-specific: the text rendition is what gets pasted
                    into chats when sourcing the items. */}
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    const id = selected.id
                    if (await copyText(reorderListText(selected))) {
                      setCopiedId(id)
                      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000)
                    }
                  }}
                  disabled={copiedId === selected.id}
                  title="Copy the item list for pasting into a chat"
                >
                  {copiedId === selected.id ? 'Copied ✓' : 'Copy'}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => void downloadList(selected, reorders || [])}
                  title="Download this list as a PDF file"
                >
                  Download PDF
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

