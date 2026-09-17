import { useEffect, useMemo, useState } from 'react'
import { api, type PurchasingItem, type PurchasingProduct, type PurchasingRecord } from '../lib/api'
import { uuid } from '../db/uuid'
import { ugx } from '../lib/format'
import { cn } from '../lib/cn'

type Props = { mode: 'receive' | 'reorder'; canReceive: boolean; onClose: () => void; onDone: (m: string) => void }
type DraftLine = PurchasingItem & { key: string }
const CATS = ['Spare part', 'Accessory', 'Consumable'] as const
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const DRAFT0 = { sku: '', name: '', barcode: '', category: 'Spare part' as (typeof CATS)[number], sell: '', reorder: '10' }

export default function ReceivingScreen({ mode, canReceive, onClose, onDone }: Props) {
  const rx = mode === 'receive'
  const [prods, setProds] = useState<PurchasingProduct[] | null>(null)
  // Authoritative capability flag: the catalog response is read from the database on
  // every call, so a permission granted in the console applies without a re-login.
  const [can, setCan] = useState(canReceive)
  const [hist, setHist] = useState<PurchasingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [ref, setRef] = useState(rx ? 'GRN-' + new Date().toISOString().slice(0, 10) + '-' : '')
  const [title, setTitle] = useState(rx ? '' : 'Reorder list')
  const [supplier, setSupplier] = useState('')
  const [delivery, setDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState(DRAFT0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const c = await api.purchasingCatalog()
        if (!dead) { setProds(c.products); setCan(c.can_receive) }
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : 'Load failed') }
      try {
        const h = rx ? await api.consignments() : await api.reorders()
        if (!dead) setHist(h.records)
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : 'History failed') }
      if (!dead) setLoading(false)
    })()
    return () => { dead = true }
  }, [rx])

  const avail = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (prods || [])
      .filter((p) => !lines.some((l) => l.product_id === p.id))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      .slice(0, 40)
  }, [prods, lines, q])

  const del = delivery === '' ? 0 : num(delivery)
  const itemsTotal = lines.reduce((s, l) => s + l.qty * (Number(l.unit_cost) || 0), 0)

  function addOne(p: PurchasingProduct) {
    setLines((v) => (v.some((l) => l.product_id === p.id) ? v : [...v, {
      key: 'p:' + p.id, product_id: p.id, sku: p.sku, name: p.name, qty: 1,
      unit_cost: Number(p.cost_price) || 0, reorder_level: Number(p.reorder_level) || 0,
    }]))
    setQ('')
  }

  function addLow() {
    if (!prods) return
    const low = prods.filter((p) => p.stock_qty <= p.reorder_level && !lines.some((l) => l.product_id === p.id))
    if (!low.length) { setErr('No low-stock products to add.'); return }
    setErr('')
    setLines((v) => [...v, ...low.map((x) => ({
      key: 'p:' + x.id, product_id: x.id, sku: x.sku, name: x.name,
      qty: Math.max(1, (Number(x.reorder_level) || 0) - x.stock_qty + 1),
      unit_cost: Number(x.cost_price) || 0, reorder_level: Number(x.reorder_level) || 0,
    }))])
  }

  function addNew() {
    if (!draft.sku.trim() || !draft.name.trim()) { setErr('New products need SKU and name.'); return }
    const sell = num(draft.sell)
    if (!Number.isFinite(sell) || sell < 0) { setErr('Enter a valid selling price.'); return }
    setErr('')
    const sku = draft.sku.trim().toUpperCase()
    const lvl = Math.round(num(draft.reorder) || 10)
    setLines((v) => [...v, {
      key: 'n:' + Date.now(), product_id: null, sku, name: draft.name.trim(), qty: 1, unit_cost: 0, reorder_level: lvl,
      new_product: { sku, name: draft.name.trim(), barcode: draft.barcode.trim(), category: draft.category, selling_price: sell, min_stock: 5, reorder_level: lvl },
    }])
    setDraft(DRAFT0)
    setShowNew(false)
  }

  async function save() {
    setErr('')
    if (!lines.length) { setErr('Add at least one item.'); return }
    if (rx && !ref.trim()) { setErr('Enter a delivery reference.'); return }
    if (rx && !supplier.trim()) { setErr('Enter the supplier name.'); return }
    if (rx && (!Number.isFinite(del) || del < 0)) { setErr('Delivery cost must be zero or more.'); return }
    if (!rx && !title.trim()) { setErr('Enter a title.'); return }
    for (const l of lines) {
      if (!Number.isInteger(l.qty) || l.qty < 1) { setErr('Qty for ' + l.name + ' must be 1 or more.'); return }
      if (rx && (!Number.isFinite(l.unit_cost) || l.unit_cost < 0)) { setErr('Unit cost for ' + l.name + ' is invalid.'); return }
    }
    setBusy(true)
    try {
      const items: PurchasingItem[] = lines.map((l) => {
        const { key, ...rest } = l
        void key
        return rest
      })
      if (rx) {
        const r = await api.createConsignment({ reference: ref.trim(), supplier: supplier.trim(), delivery_cost: del, notes: notes.trim(), client_txn_id: uuid(), items })
        onDone(r.duplicate ? 'Delivery already recorded.' : 'Consignment ' + r.record.reference + ' received.')
      } else {
        const r = await api.createReorder({ title: title.trim(), notes: notes.trim(), client_txn_id: uuid(), items })
        onDone(r.duplicate ? 'Reorder list already saved.' : 'Reorder list saved.')
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-white text-lg">{rx ? 'Receive consignment' : 'Prepare reorder list'}</h3>
            <p className="text-xs text-slate-500">{rx ? 'Stock updates immediately. New products can be created inline.' : 'Draft what to order next. Reorders never change stock.'}</p>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
        </div>
        {!rx && <button type="button" className="btn-ghost text-xs mb-3" onClick={addLow}>+ Suggest low-stock items</button>}
        {rx && !can && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">No receive permission yet — an admin can grant “Inventory entry” in Team &amp; Codes.</p>}
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          {rx ? (
            <>
              <label className="block"><span className="text-xs text-slate-400">Delivery reference *</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="GRN-2026-001" /></label>
              <label className="block"><span className="text-xs text-slate-400">Supplier *</span><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></label>
              <label className="block"><span className="text-xs text-slate-400">Delivery cost (UGX)</span><input className="input" type="number" min={0} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="0" /></label>
              <label className="block"><span className="text-xs text-slate-400">Note</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
            </>
          ) : (
            <>
              <label className="block"><span className="text-xs text-slate-400">List title *</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="block"><span className="text-xs text-slate-400">Note</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
            </>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Add existing product</div>
            <input className="input mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU" />
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {prods === null && <div className="text-xs text-slate-600 py-6 text-center">Loading</div>}
              {prods !== null && avail.length === 0 && <div className="text-xs text-slate-600 py-6 text-center">No products match.</div>}
              {avail.map((p) => (
                <button key={p.id} type="button" onClick={() => addOne(p)} className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-800 hover:border-brand-500/50">
                  <div className="text-sm text-white truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{p.sku} - {p.stock_qty} in stock</div>
                </button>
              ))}
            </div>
            {rx && <button type="button" className="btn-ghost text-xs w-full mt-2" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Hide new product' : '+ New product'}</button>}
            {rx && showNew && (
              <div className="mt-2 space-y-2 border-t border-slate-800/70 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="SKU *" />
                  <input className="input" value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} placeholder="Barcode" />
                </div>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Product name *" />
                <div className="grid grid-cols-3 gap-2">
                  <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as (typeof CATS)[number] })}>
                    {CATS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className="input" type="number" min={0} value={draft.sell} onChange={(e) => setDraft({ ...draft, sell: e.target.value })} placeholder="Sell *" />
                  <input className="input" type="number" min={0} value={draft.reorder} onChange={(e) => setDraft({ ...draft, reorder: e.target.value })} placeholder="Reorder" />
                </div>
                <button type="button" className="btn-primary text-xs w-full" onClick={addNew}>Add to delivery</button>
              </div>
            )}
          </div>
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Current draft</div>
            {lines.length === 0 && <div className="text-xs text-slate-600 py-8 text-center">Nothing added yet.</div>}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {lines.map((l) => (
                <div key={l.key} className="border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="text-sm text-white truncate">{l.name}</div><div className="text-[11px] text-slate-500 font-mono">{l.sku}</div></div>
                    <button type="button" className="text-slate-600 hover:text-red-400 text-xs" onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}>X</button>
                  </div>
                  <div className={cn('grid gap-2 mt-2', rx ? 'grid-cols-2' : 'grid-cols-1')}>
                    <label className="block"><span className="text-[11px] text-slate-500">Qty</span><input className="input" type="number" min={1} value={String(l.qty)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x))} /></label>
                    {rx && <label className="block"><span className="text-[11px] text-slate-500">Unit cost</span><input className="input" type="number" min={0} value={String(l.unit_cost)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, unit_cost: Number(e.target.value) || 0 } : x))} /></label>}
                  </div>
                </div>
              ))}
            </div>
            {rx && lines.length > 0 && <div className="text-xs text-slate-400 mt-2"><div className="flex justify-between"><span>Landed total</span><span className="text-brand-300 font-semibold">{ugx(itemsTotal + (Number.isFinite(del) ? del : 0))}</span></div></div>}
          </div>
        </div>
        {err && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">{err}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || (rx && !can)} onClick={() => void save()}>{busy ? 'Saving' : rx ? 'Receive stock' : 'Save reorder'}</button>
        </div>

        <div className="mt-4 border-t border-slate-800/70 pt-3">
          <div className="text-xs font-semibold text-slate-300 mb-2">{rx ? 'Recent deliveries' : 'Saved lists'}</div>
          {loading ? <div className="text-xs text-slate-600">Loading</div> : hist.length === 0 ? <div className="text-xs text-slate-600">None yet.</div> : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {hist.slice(0, 20).map((r) => (
                <div key={r.id} className="text-xs text-slate-400 border border-slate-800 rounded-lg px-2.5 py-2">
                  <div className="text-white">{rx ? r.reference : r.title} - {r.items.length} items</div>
                  <div>{r.items.map((i) => i.name + ' x' + i.qty).join(', ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}



