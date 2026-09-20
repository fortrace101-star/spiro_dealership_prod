import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, num, ugx } from '../lib/format'
import type { Product, PurchasingRecord } from '../lib/types'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'
import { printHtml, escapeHtml } from '../lib/print'

interface Line {
  product_id: string
  sku: string
  name: string
  qty: string
}

function txnId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Renders the open detail record (reorder list or consignment) into a printable PDF document. */
function printDetail(tab: 'reorders' | 'consignments', d: PurchasingRecord): void {
  const isReorder = tab === 'reorders'
  const rows = d.items
    .map((i) => {
      const unit = Number(i.unit_cost) || 0
      const qty = Number(i.qty) || 0
      const isNew = (i as { new_product?: unknown }).new_product
      return `<tr><td>${escapeHtml(i.sku || '')}</td><td>${escapeHtml(i.name || '')}${isNew ? ' <em>(new)</em>' : ''}</td><td class="num">${qty}</td><td class="num">${unit.toLocaleString('en-UG')}</td><td class="num">${(qty * unit).toLocaleString('en-UG')}</td></tr>`
    })
    .join('')
  const value = d.items.reduce((s, i) => s + Number(i.qty) * (Number(i.unit_cost) || 0), 0)
  const delivery = Number(d.delivery_cost || 0)
  const title = isReorder ? d.title || 'Reorder list' : `Consignment ${d.reference || ''}`
  let totals = `<tr><td colspan="4">Total (${d.items.length} line${d.items.length === 1 ? '' : 's'})</td><td class="num">${value.toLocaleString('en-UG')}</td></tr>`
  if (!isReorder) {
    totals += `<tr><td colspan="4">Delivery</td><td class="num">${delivery.toLocaleString('en-UG')}</td></tr>`
    totals += `<tr><td colspan="4">Landed total</td><td class="num">${(value + delivery).toLocaleString('en-UG')}</td></tr>`
  }
  printHtml(
    title,
    `<h1>${escapeHtml(title)}</h1>
<div class="meta">${isReorder ? 'Reorder list' : 'Received consignment'} · prepared by ${escapeHtml(d.created_by_name || '—')} · ${escapeHtml(dateTime(d.created_at))}${d.notes ? ` · ${escapeHtml(d.notes)}` : ''}${!isReorder && (d.source_reorder_title || d.source_reorder_id) ? ` · Fulfills: ${escapeHtml(d.source_reorder_title || 'Reorder list')}` : ''}</div>
<table><thead><tr><th>SKU</th><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Line total</th></tr></thead>
<tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>`,
  )
}

export default function ReordersPage() {
  const [tab, setTab] = useState<'reorders' | 'consignments'>('reorders')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'processed' | 'fulfilled'>('all')
  const [records, setRecords] = useState<PurchasingRecord[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setRecords(null)
    const r = tab === 'reorders' ? await api.reorders(statusFilter) : await api.consignments()
    setRecords(r.records)
  }, [tab, statusFilter])

  useEffect(() => {
    load().catch(() => setRecords([]))
  }, [load])

  useEffect(() => {
    api.purchasingCatalog().then((r) => setProducts(r.products)).catch(() => setProducts([]))
  }, [])

  const lowStock = useMemo(
    () => (products || []).filter((p) => p.stock_qty <= p.reorder_level),
    [products],
  )

  const [detail, setDetail] = useState<PurchasingRecord | null>(null)
  // Per-status counts that power the badges on the filter buttons.
  const [counts, setCounts] = useState<{ pending: number; processed: number; fulfilled: number; cancelled: number } | null>(null)

  const loadCounts = useCallback(
    () => api.reorderCounts().then((r) => setCounts(r.counts)).catch(() => setCounts(null)),
    [],
  )

  useEffect(() => {
    loadCounts()
  }, [loadCounts, tab])

  const listValue = (r: PurchasingRecord) =>
    r.items.reduce((s, i) => s + i.qty * (Number(i.unit_cost) || 0), 0)

  return (
    <div>
      <PageHeader
        title="Purchasing"
        subtitle="Prepare reorder lists from any terminal and review received consignments"
        actions={<button className="btn-primary" onClick={() => { setShowForm(true); setError('') }}>+ New reorder list</button>}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <button className={tab === 'reorders' ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setTab('reorders')}>
          Reorder lists
        </button>
        <button className={tab === 'consignments' ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setTab('consignments')}>
          Received consignments
        </button>
        {products && (
          <span className="ml-auto text-sm text-slate-500 self-center">
            {lowStock.length} product{lowStock.length === 1 ? '' : 's'} at or below reorder level
          </span>
        )}
      </div>

      {tab === 'reorders' && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(['pending', 'processed', 'fulfilled'] as const).map((s) => {
            const count = counts ? counts[s] : null
            const showBadge = count !== null && count > 0 && s !== 'fulfilled'
            return (
              <button
                key={s}
                className={statusFilter === s ? 'btn-primary text-xs capitalize relative' : 'btn-ghost text-xs capitalize relative'}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'processed' ? 'Processing' : s}
                {showBadge && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-900 ${
                      s === 'fulfilled' ? 'bg-emerald-500 ring-emerald-900' : 'bg-orange-500 ring-orange-900'
                    }`}
                  >
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">{error}</p>}

      <div className="card overflow-hidden">
        {records === null ? (
          <Spinner />
        ) : records.length === 0 ? (
          <EmptyState message={tab === 'reorders' ? 'No reorder lists yet.' : 'No consignments received yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">{tab === 'reorders' ? 'List' : 'Reference'}</th>
                  <th className="th">Items</th>
                  {tab === 'consignments' && <th className="th">Supplier</th>}
                  <th className="th text-right">{tab === 'reorders' ? 'Est. value' : 'Items total'}</th>
                  {tab === 'consignments' && <th className="th text-right">Delivery</th>}
                  <th className="th">Prepared by</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => setDetail(r)}>
                    <td className="td">
                      <div className="font-medium text-white underline decoration-slate-600 underline-offset-2">{tab === 'reorders' ? r.title : r.reference}</div>
                      {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
                      {tab === 'consignments' && (r.source_reorder_title || r.source_reorder_id) && (
                        <div className="text-[11px] text-sky-300">Fulfills: {r.source_reorder_title || 'Reorder list'}</div>
                      )}
                    </td>
                    <td className="td text-slate-400 text-xs">
                      {r.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
                    </td>
                    {tab === 'consignments' && <td className="td text-slate-400 text-xs">{r.supplier || '—'}</td>}
                    <td className="td text-right">{ugx(tab === 'reorders' ? listValue(r) : Number(r.items_total || 0))}</td>
                    {tab === 'consignments' && <td className="td text-right text-slate-400">{ugx(Number(r.delivery_cost || 0))}</td>}
                    <td className="td text-slate-400 text-xs">{r.created_by_name || '—'}</td>
                    <td className="td text-xs text-slate-500">{dateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {lowStock.length > 0 && tab === 'reorders' && (
        <div className="card p-4 mt-4">
          <div className="text-sm font-semibold text-white mb-2">Needs restocking</div>
          <div className="flex flex-wrap gap-2">
            {lowStock.slice(0, 24).map((p) => (
              <span key={p.id} className="text-xs px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
                {p.name} · {num(p.stock_qty)} left (lvl {num(p.reorder_level)})
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && products && (
        <ReorderForm
          products={products}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setTab('reorders'); load() }}
        />
      )}

      {detail && (
        <Modal
          title={tab === 'reorders' ? (detail.title || 'Reorder list') : `Consignment ${detail.reference || ''}`}
          onClose={() => setDetail(null)}
        >
          <p className="text-xs text-slate-500 -mt-2 mb-3 flex items-start justify-between gap-3">
            <span>
              {tab === 'reorders' ? 'Reorder list' : 'Received consignment'} · prepared by {detail.created_by_name || '—'} · {dateTime(detail.created_at)}
              {tab === 'consignments' && (detail.source_reorder_title || detail.source_reorder_id) && (
                <span className="text-sky-300"> · Fulfills: {detail.source_reorder_title || 'Reorder list'}</span>
              )}
              {detail.notes ? ` · ${detail.notes}` : ''}
            </span>
            <button
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-md border border-slate-700 text-slate-300 hover:border-brand-500/60 hover:text-brand-300"
              onClick={() => printDetail(tab, detail)}
            >
              Print / PDF
            </button>
          </p>
          <div className="overflow-x-auto card">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">SKU</th>
                  <th className="th">Product</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Unit cost</th>
                  <th className="th text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i, idx) => {
                  const unit = Number(i.unit_cost) || 0
                  const qty = Number(i.qty) || 0
                  return (
                    <tr key={i.product_id || `new-${idx}`}>
                      <td className="td font-mono text-xs text-brand-300">{i.sku}</td>
                      <td className="td text-white">{i.name}{(i as { new_product?: unknown }).new_product ? <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300">new</span> : null}</td>
                      <td className="td text-right tabular-nums">{qty.toLocaleString('en-UG')}</td>
                      <td className="td text-right tabular-nums text-slate-400">{ugx(unit)}</td>
                      <td className="td text-right tabular-nums">{ugx(qty * unit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-end gap-4 mt-3 text-sm">
            <span className="text-slate-500">{detail.items.length} item{detail.items.length === 1 ? '' : 's'}</span>
            <span>
              <span className="text-slate-500">{tab === 'reorders' ? 'Est. value' : 'Items total'}: </span>
              <span className="text-white font-semibold">{ugx(tab === 'reorders' ? listValue(detail) : Number(detail.items_total || 0))}</span>
            </span>
            {tab === 'consignments' && (
              <>
                <span>
                  <span className="text-slate-500">Delivery: </span>
                  <span className="text-white font-semibold">{ugx(Number(detail.delivery_cost || 0))}</span>
                </span>
                <span>
                  <span className="text-slate-500">Landed total: </span>
                  <span className="text-brand-300 font-semibold">{ugx(Number(detail.items_total || 0) + Number(detail.delivery_cost || 0))}</span>
                </span>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
function ReorderForm({ products, onClose, onSaved }: { products: Product[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(`Reorder — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products
      .filter((p) => !lines.some((l) => l.product_id === p.id))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      .slice(0, 30)
  }, [products, q, lines])

  function add(p: Product) {
    setLines((v) => [...v, {
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      qty: String(Math.max(1, (Number(p.reorder_level) || 0) - Number(p.stock_qty) + 1)),
    }])
    setQ('')
  }

  function addLowStock() {
    const low = products.filter((p) => p.stock_qty <= p.reorder_level && !lines.some((l) => l.product_id === p.id))
    if (low.length === 0) {
      setError('Every product is above its reorder level.')
      return
    }
    setError('')
    setLines((v) => [...v, ...low.map((p) => ({
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      qty: String(Math.max(1, (Number(p.reorder_level) || 0) - Number(p.stock_qty) + 1)),
    }))])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Enter a title for this list')
      return
    }
    if (lines.length === 0) {
      setError('Add at least one product')
      return
    }
    const items: { product_id: string; qty: number }[] = []
    for (const l of lines) {
      const n = Math.floor(Number(l.qty))
      if (!Number.isInteger(n) || n < 1) {
        setError(`Quantity for ${l.name} must be a whole number of 1 or more`)
        return
      }
      items.push({ product_id: l.product_id, qty: n })
    }
    setBusy(true)
    try {
      const r = await api.createReorder({ title: title.trim(), notes: notes.trim(), client_txn_id: txnId(), items })
      void r
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <Modal title="New reorder list" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Title *"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Note"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-ghost text-xs" onClick={addLowStock}>+ Add low-stock items</button>
          <span className="text-[11px] text-slate-600">Quantity defaults to cover the reorder level.</span>
        </div>

        <Field label="Add product">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU…" />
        </Field>
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {matches.length === 0 && <div className="text-xs text-slate-600 text-center py-3">No products match.</div>}
          {matches.map((p) => (
            <button key={p.id} type="button" onClick={() => add(p)} className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-800 hover:border-brand-500/50 transition">
              <div className="text-sm text-white truncate">{p.name}</div>
              <div className="text-[11px] text-slate-500 font-mono">{p.sku} · {num(p.stock_qty)} in stock · lvl {num(p.reorder_level)}</div>
            </button>
          ))}
        </div>

        <div className="border-t border-slate-800/70 pt-3">
          <div className="text-xs font-semibold text-slate-300 mb-2">Items ({lines.length})</div>
          {lines.length === 0 && <div className="text-xs text-slate-600 text-center py-4">Nothing added yet.</div>}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {lines.map((l) => (
              <div key={l.product_id} className="flex items-center gap-2 border-2 border-sky-500 rounded-xl px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{l.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{l.sku}</div>
                </div>
                <input
                  className="input w-20"
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => setLines((v) => v.map((x) => (x.product_id === l.product_id ? { ...x, qty: e.target.value } : x)))}
                />
                <button type="button" className="text-slate-600 hover:text-red-400 text-xs" onClick={() => setLines((v) => v.filter((x) => x.product_id !== l.product_id))}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-ghost w-full sm:w-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? 'Saving…' : 'Save reorder list'}</button>
        </div>
      </form>
    </Modal>
  )
}

