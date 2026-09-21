import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Product, PurchasingListItem, PurchasingRecord } from '../lib/types'
import { ugx } from '../lib/format'
import { cn } from '../lib/cn'

type DraftLine = PurchasingListItem & { key: string }

type Props = {
  /** The reorder list being fulfilled — its lines pre-fill the delivery. */
  list: PurchasingRecord
  onClose: () => void
  onDone: (msg: string) => void
}

function txnId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Admin receive-stock modal — the admin counterpart of the POS receiving screen.
 * Opens pre-filled with the reorder list's items (never empty); saving records a
 * consignment linked to the list via source_list_id, which the server uses to mark
 * the list fulfilled and update product stock.
 */
export default function ReceiveStockModal({ list, onClose, onDone }: Props) {
  const [prods, setProds] = useState<Product[] | null>(null)
  const [lines, setLines] = useState<DraftLine[]>(() =>
    list.items.map((i) => ({ ...i, key: 's:' + (i.product_id || i.name) })),
  )
  // Delivery reference defaults to the reorder list title plus " - STK"
  // (e.g. "Reorder - 20 Sep - 01 - STK") so the delivery is traceable to the
  // list it fulfils; still editable and required.
  const [ref, setRef] = useState(() => {
    const t = list.title || list.reference || ''
    return t ? t + ' - STK' : ''
  })
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [supplier, setSupplier] = useState('')
  const [delivery, setDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let dead = false
    api.purchasingCatalog()
      .then((r) => { if (!dead) setProds(r.products) })
      .catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : 'Load failed') })
    return () => { dead = true }
  }, [])

  const avail = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (prods || [])
      .filter((p) => !lines.some((l) => l.product_id === p.id))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      .slice(0, 40)
  }, [prods, lines, q])

  const del = delivery === '' ? 0 : Number(delivery)
  const itemsTotal = lines.reduce((s, l) => s + l.qty * (Number(l.unit_cost) || 0), 0)

  function addOne(p: Product) {
    setLines((v) => (v.some((l) => l.product_id === p.id) ? v : [...v, {
      key: 'p:' + p.id, product_id: p.id, sku: p.sku, name: p.name, qty: 1,
      unit_cost: Number(p.cost_price) || 0,
    }]))
    setQ('')
  }

  async function save() {
    setErr('')
    if (!lines.length) { setErr('Add at least one item.'); return }
    if (!ref.trim()) { setErr('Enter a delivery reference.'); return }
    if (!supplier.trim()) { setErr('Enter the supplier name.'); return }
    if (!Number.isFinite(del) || del < 0) { setErr('Delivery cost must be zero or more.'); return }
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty < 1) { setErr('Qty for ' + l.name + ' must be 1 or more.'); return }
      if (!Number.isFinite(Number(l.unit_cost)) || Number(l.unit_cost) < 0) { setErr('Unit cost for ' + l.name + ' is invalid.'); return }
      // New products get their retail price set here, at receive time — the catalog
      // row is created with it, so it must be a real price, not the 0 placeholder.
      if (l.new_product && !(Number(l.new_product.selling_price) > 0)) { setErr('Set a selling price for new product ' + l.name + '.'); return }
    }
    setBusy(true)
    try {
      const items: PurchasingListItem[] = lines.map((l) => {
        const { key, ...rest } = l
        void key
        return rest
      })
      const r = await api.createConsignment({
        reference: ref.trim(),
        supplier: supplier.trim(),
        delivery_cost: del,
        notes: notes.trim(),
        client_txn_id: txnId(),
        items,
        source_list_id: list.id,
      })
      onDone(r.duplicate ? 'Delivery already recorded.' : 'Consignment ' + r.record.reference + ' received — list fulfilled.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      setBusy(false)
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative card w-full sm:max-w-2xl rounded-b-none sm:rounded-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Receive stock — {list.title || 'Reorder list'}</h3>
          <button className="text-slate-500 hover:text-white text-xl leading-none" onClick={onClose}>×</button>
        </div>

        <p className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 mb-3">
          Fulfilling reorder list: <span className="font-medium">{list.title || 'untitled'}</span> · {list.items.length} item{list.items.length === 1 ? '' : 's'} · receiving marks this list fulfilled and updates product stock.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block"><span className="text-xs text-slate-400">Delivery reference *</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Delivery reference" /></label>
          <label className="block"><span className="text-xs text-slate-400">Supplier *</span><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></label>
          <label className="block"><span className="text-xs text-slate-400">Delivery cost (UGX)</span><input className="input" type="number" min={0} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Delivery cost (UGX)" /></label>
          <label className="block"><span className="text-xs text-slate-400">Note</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" /></label>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Add existing product</div>
            <input className="input mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU…" />
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {prods === null && <div className="text-xs text-slate-500 py-6 text-center">Loading</div>}
              {prods !== null && avail.length === 0 && <div className="text-xs text-slate-500 py-6 text-center">No products match.</div>}
              {avail.map((p) => (
                <button key={p.id} type="button" onClick={() => addOne(p)} className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-800 hover:border-brand-500/50">
                  <div className="text-sm text-white truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{p.sku} · {p.stock_qty} in stock</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Delivery items</div>
            {lines.length === 0 && <div className="text-xs text-slate-500 py-8 text-center">Nothing added yet.</div>}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {lines.map((l) => (
                <div key={l.key} className={cn('rounded-xl p-2.5 border', l.new_product ? 'bg-gradient-to-br from-brand-500/15 to-transparent border-brand-500/30' : 'border-slate-800')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{l.name}{l.new_product && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300">new</span>}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{l.sku}</div>
                    </div>
                    <button type="button" className="text-slate-600 hover:text-red-400 text-xs" onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}>✕</button>
                  </div>
                  <div className="grid gap-2 mt-2 grid-cols-2">
                    <label className="block"><span className="text-[11px] text-slate-500">Qty</span><input className="input" type="number" min={1} value={String(l.qty)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x))} /></label>
                    <label className="block"><span className="text-[11px] text-slate-500">Unit cost</span><input className="input" type="number" min={0} value={String(l.unit_cost)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, unit_cost: Number(e.target.value) || 0 } : x))} /></label>
                    {l.new_product && (
                      <label className="block">
                        <span className="text-[11px] text-brand-300">Selling price (UGX) *</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          // Empty (not "0") until the admin types a price — a blank
                          // field forces entry, while a price already set on the
                          // reorder list persists into the field.
                          value={l.new_product.selling_price ? String(l.new_product.selling_price) : ''}
                          onChange={(e) => setLines((v) => v.map((x) => x.key === l.key && x.new_product
                            ? { ...x, new_product: { ...x.new_product, selling_price: Number(e.target.value) || 0 } }
                            : x))}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {lines.length > 0 && (
              <div className="text-xs text-slate-400 mt-2">
                <div className="flex justify-between"><span>Landed total</span><span className="text-brand-300 font-semibold">{ugx(itemsTotal + (Number.isFinite(del) ? del : 0))}</span></div>
              </div>
            )}
          </div>
        </div>

        {err && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving' : 'Receive stock'}</button>
        </div>
      </div>
    </div>
  )
}
