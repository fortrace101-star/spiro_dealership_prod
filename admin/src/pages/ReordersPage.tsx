import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, num, ugx } from '../lib/format'
import type { Product, PurchasingRecord } from '../lib/types'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

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

export default function ReordersPage() {
  const [tab, setTab] = useState<'reorders' | 'consignments'>('reorders')
  const [records, setRecords] = useState<PurchasingRecord[] | null>(null)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setRecords(null)
    const r = tab === 'reorders' ? await api.reorders() : await api.consignments()
    setRecords(r.records)
  }, [tab])

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

  const listValue = (r: PurchasingRecord) =>
    r.items.reduce((s, i) => s + i.qty * (Number(i.unit_cost) || 0), 0)

  return (
    <div>
      <PageHeader
        title="Purchasing"
        subtitle="Prepare reorder lists from any terminal and review received consignments"
        actions={<button className="btn-primary" onClick={() => { setShowForm(true); setError('') }}>+ New reorder list</button>}
      />

      <div className="flex gap-2 mb-4">
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
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="td">
                      <div className="font-medium text-white">{tab === 'reorders' ? r.title : r.reference}</div>
                      {r.notes && <div className="text-xs text-slate-500">{r.notes}</div>}
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
        <div className="grid grid-cols-2 gap-3">
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
              <div key={l.product_id} className="flex items-center gap-2 border border-slate-800 rounded-xl px-2.5 py-2">
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
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save reorder list'}</button>
        </div>
      </form>
    </Modal>
  )
}

