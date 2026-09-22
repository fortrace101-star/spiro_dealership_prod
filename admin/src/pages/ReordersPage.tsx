import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { compactUgx, dateTime, num, timeAgo, ugx } from '../lib/format'
import type { Product, PurchasingRecord } from '../lib/types'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'
import ReceiveStockModal from '../components/ReceiveStockModal'
import { printHtml, escapeHtml } from '../lib/print'
import { usePageSize } from '../lib/usePageSize'

interface Line {
  product_id: string | null
  sku: string
  name: string
  qty: string
  unit_cost?: number
  reorder_level?: number
  new_product?: {
    sku: string
    name: string
    barcode: string
    category: string
    selling_price: number
    min_stock: number
    reorder_level: number
  }
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
  const title = isReorder ? d.title || 'Reorder list' : `Received ${d.reference || 'consignment'}`
  let totals = `<tr><td colspan="4">Total (${d.items.length} line${d.items.length === 1 ? '' : 's'})</td><td class="num">${value.toLocaleString('en-UG')}</td></tr>`
  if (!isReorder) {
    totals += `<tr><td colspan="4">Delivery</td><td class="num">${delivery.toLocaleString('en-UG')}</td></tr>`
    totals += `<tr><td colspan="4">Landed total</td><td class="num">${(value + delivery).toLocaleString('en-UG')}</td></tr>`
  }
  printHtml(
    title,
    `<h1>${escapeHtml(title)}</h1>
<div class="meta">${isReorder ? 'Reorder list' : 'Received consignment'} · prepared by ${escapeHtml(d.created_by_name || '—')} · ${escapeHtml(dateTime(d.created_at))}${d.notes ? ` · ${escapeHtml(d.notes)}` : ''}${!isReorder && (d.source_list_title || d.source_list_id) ? ` · Fulfills: ${escapeHtml(d.source_list_title || 'Reorder list')}` : ''}</div>
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
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    setRecords(null)
    const r = tab === 'reorders' ? await api.reorders(statusFilter) : await api.consignments()
    setRecords(r.records)
  }, [tab, statusFilter])

  useEffect(() => {
    setPage(1) // reset page when the tab or status filter changes
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
  const [statusBusy, setStatusBusy] = useState(false)
  // Reorder list currently being received (fulfilled) via the receive-stock modal.
  const [receiveFor, setReceiveFor] = useState<PurchasingRecord | null>(null)
  const [flash, setFlash] = useState('')

  /** Advance an open reorder list's status from the detail modal (processed). */
  const setReorderStatus = async (r: PurchasingRecord, status: 'processed') => {
    setStatusBusy(true)
    try {
      await api.updateReorderStatus(r.id, status)
      setDetail({ ...r, status })
      await Promise.all([load(), loadCounts()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setStatusBusy(false)
    }
  }

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

  // Client-side pagination (10 rows on phones / 20 on PC), matching the other tables.
  const totalPages = Math.max(1, Math.ceil((records?.length || 0) / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = (records || []).slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeFrom = (records?.length || 0) === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeTo = Math.min(safePage * pageSize, records?.length || 0)

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
          Received stock
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
            const showBadge = count !== null && count > 0 && (s === 'pending' || s === 'processed')
            return (
              <button
                key={s}
                className={statusFilter === s ? 'btn-primary text-xs capitalize relative' : 'btn-ghost text-xs capitalize relative'}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'processed' ? 'Processing' : s}
                {showBadge && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-900 bg-orange-500 ring-orange-900`}
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
  {flash && <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 mb-3">{flash}</p>}

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
                  <th className="th col-opt">Items</th>
                  {tab === 'consignments' && <th className="th col-opt">Supplier</th>}
                  <th className="th text-right">{tab === 'reorders' ? 'Est. value' : 'Items total'}</th>
                  {tab === 'consignments' && <th className="th col-opt text-right">Delivery</th>}
                  <th className="th col-opt">Prepared by</th>
                  <th className="th">When</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => setDetail(r)}>
                    <td className="td">
                      <div className="font-medium text-white underline decoration-slate-600 underline-offset-2">{tab === 'reorders' ? r.title : r.reference}</div>
                      {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
                      {tab === 'consignments' && (r.source_list_title || r.source_list_id) && (
                        <div className="text-[11px] text-sky-300">Fulfills: {r.source_list_title || 'Reorder list'}</div>
                      )}
                    </td>
                    <td className="td col-opt text-slate-400 text-xs">
                      {r.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
                    </td>
                    {tab === 'consignments' && <td className="td col-opt text-slate-400 text-xs">{r.supplier || '—'}</td>}
                    <td className="td text-right whitespace-nowrap">
                      {/* Phones get the compact form so Reference + total + When fit one line. */}
                      <span className="sm:hidden">{compactUgx(tab === 'reorders' ? listValue(r) : Number(r.items_total || 0))}</span>
                      <span className="hidden sm:inline">{ugx(tab === 'reorders' ? listValue(r) : Number(r.items_total || 0))}</span>
                    </td>
                    {tab === 'consignments' && <td className="td col-opt text-right text-slate-400 whitespace-nowrap">{ugx(Number(r.delivery_cost || 0))}</td>}
                    <td className="td col-opt text-slate-400 text-xs">{r.created_by_name || '—'}</td>
                    <td className="td text-xs text-slate-500 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="sm:hidden">{timeAgo(r.created_at)}</span>
                        <span className="hidden sm:inline">{dateTime(r.created_at)}</span>
                        {/* Phones hide the other columns, so the row advertises the tap-through. */}
                        <span className="sm:hidden text-slate-600">›</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {records && records.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-slate-500">Showing {rangeFrom}–{rangeTo} of {records.length}</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <span className="text-slate-400 text-xs">Page {safePage} of {totalPages}</span>
            <button className="btn-ghost text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        </div>
      )}

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
          title={tab === 'reorders' ? (detail.title || 'Reorder list') : `Received ${detail.reference || 'consignment'}`}
          onClose={() => setDetail(null)}
        >
          <p className="text-xs text-slate-500 -mt-2 mb-3 flex items-start justify-between gap-3">
            <span>
              {tab === 'reorders' ? 'Reorder list' : 'Received Stock'} · by {detail.created_by_name || '—'} · {dateTime(detail.created_at)}
              {/* Supplier is a hidden table column on phones, so the modal must carry it. */}
              {detail.supplier ? ` · Supplier: ${detail.supplier}` : ''}
              {tab === 'consignments' && (detail.source_list_title || detail.source_list_id) && (
                <span className="text-sky-300"> · Fulfills {detail.source_list_title || 'Reorder list'}</span>
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
          {tab === 'reorders' && detail.status !== 'fulfilled' && detail.status !== 'cancelled' && (
            <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-800">
              <span className="mr-auto text-xs text-slate-500">
                Status: <span className="text-slate-300 font-medium">{detail.status || 'pending'}</span>
              </span>
              {/* "Start processing" only makes sense while the list is still pending. */}
              {detail.status === 'pending' && (
                <button
                  className="btn-ghost"
                  disabled={statusBusy}
                  onClick={() => setReorderStatus(detail, 'processed')}
                >
                  Start processing
                </button>
              )}
              {/* Fulfillment happens by receiving the delivery, never a bare status flip. */}
              {detail.status === 'processed' && (
                <button
                  className="btn-primary"
                  onClick={() => setReceiveFor(detail)}
                >
                  Receive stock
                </button>
              )}
              {statusBusy && <span className="text-xs text-slate-500">Updating…</span>}
            </div>
          )}
        </Modal>
      )}
      {receiveFor && (
        <ReceiveStockModal
          list={receiveFor}
          onClose={() => setReceiveFor(null)}
          onDone={(msg) => {
            setReceiveFor(null)
            setDetail(null)
            setFlash(msg)
            load()
            loadCounts()
          }}
        />
      )}
    </div>
  )
}
function ReorderForm({ products, onClose, onSaved }: { products: Product[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Default the reorder list title to the server-generated value (e.g.
  // Reorder - 20 Sep - 01) so the admin form matches the POS default.
  // Only fills in while the field is still empty, so a title the admin
  // already typed is never overwritten.
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const nr = await api.nextReorderRef()
        if (!dead && !title) setTitle(nr.title)
      } catch { /* offline: leave empty — the server still defaults it on save */ }
    })()
    return () => { dead = true }
  }, [])

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

  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({ sku: '', name: '', barcode: '', category: '', cost: '', qty: '', reorder: '' })

  function startNew() {
    setShowNew((v) => !v)
  }

  function addNew() {
    if (!draft.sku.trim() || !draft.name.trim()) { setError('New products need SKU and name.'); return }
    const cost = draft.cost.trim() === '' ? 0 : Math.floor(Number(draft.cost) || 0)
    const qty = Math.max(1, Math.floor(Number(draft.qty) || 1))
    const sku = draft.sku.trim().toUpperCase()
    const lvl = Math.round(Number(draft.reorder) || 10)
    setError('')
    setLines((v) => [...v, {
      product_id: null,
      sku,
      name: draft.name.trim(),
      qty: String(qty),
      unit_cost: cost,
      reorder_level: lvl,
      new_product: { sku, name: draft.name.trim(), barcode: draft.barcode.trim(), category: draft.category, selling_price: 0, min_stock: 5, reorder_level: lvl },
    }])
    setDraft({ sku: '', name: '', barcode: '', category: '', cost: '', qty: '', reorder: '' })
    setShowNew(false)
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
    const items: { product_id: string | null; sku: string; name: string; qty: number; unit_cost?: number; reorder_level?: number; new_product?: { sku: string; name: string; barcode: string; category: string; selling_price: number; min_stock: number; reorder_level: number } }[] = []
    for (const l of lines) {
      const n = Math.floor(Number(l.qty))
      if (!Number.isInteger(n) || n < 1) {
        setError(`Quantity for ${l.name} must be a whole number of 1 or more`)
        return
      }
      const item: typeof items[number] = { product_id: l.product_id, sku: l.sku, name: l.name, qty: n }
      if (l.unit_cost != null) item.unit_cost = l.unit_cost
      if (l.reorder_level != null) item.reorder_level = l.reorder_level
      if (l.new_product) item.new_product = l.new_product
      items.push(item)
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
          <button type="button" className="btn-ghost text-xs" onClick={startNew}>{showNew ? 'Hide new product' : '+ New product'}</button>
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

        {showNew && (
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">New product</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="SKU" />
              <input className="input" value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} placeholder="Barcode" />
            </div>
            <input className="input mt-2" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Product name" />
            <div className="grid grid-cols-2 gap-2 mt-2">
              <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                <option value="">— Select category —</option>
                {['Spare Parts', 'Accessories', 'Consumables', 'e-Bikes', 'e-Bikes Spare Parts'].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input className="input" type="number" min={0} value={draft.reorder} onChange={(e) => setDraft({ ...draft, reorder: e.target.value })} placeholder="Reorder level" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input className="input" type="number" min={0} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} placeholder="Unit cost (UGX)" />
              <input className="input" type="number" min={1} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder="Quantity" />
            </div>
            <button type="button" className="btn-primary text-xs w-full mt-2" onClick={addNew}>Add to list</button>
          </div>
        )}

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

