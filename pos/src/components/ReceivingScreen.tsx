import { useEffect, useMemo, useState } from 'react'
import { api, can as canPerm, type ProductCategory, type PurchasingItem, type PurchasingProduct, type PurchasingRecord, PRODUCT_CATEGORIES } from '../lib/api'
import { uuid } from '../db/uuid'
import { ugx } from '../lib/format'
import { cn } from '../lib/cn'
type Props = {
  mode: 'receive' | 'reorder'
  canReceive: boolean
  onClose: () => void
  onDone: (m: string) => void
  /** An existing reorder list this delivery is fulfilling (receive mode). */
  sourceList?: PurchasingRecord
}
type DraftLine = PurchasingItem & { key: string; selling_price?: number }
const CATS = PRODUCT_CATEGORIES
const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
const DRAFT0 = { sku: '', name: '', barcode: '', category: '' as ProductCategory, cost: '', qty: '', reorder: '', sell: '' }
export default function ReceivingScreen({ mode, canReceive, onClose, onDone, sourceList }: Props) {
  const rx = mode === 'receive'
  const [prods, setProds] = useState<PurchasingProduct[] | null>(null)
  // Authoritative capability flag: the catalog response is read from the database on
  // every call, so a permission granted in the console applies without a re-login.
  // Inline product creation rides on the same grant — receiving is all-or-nothing
  // (fulfil a list, start a standalone restock, create new SKUs).
  const [can, setCan] = useState(canReceive)
  // Creating a reorder list is its own grant (`reorder_create`): a manage-only
  // user sees only the current lists — no drafting section, no Save/Cancel.
  const [canCreateList, setCanCreateList] = useState(() => canPerm('reorder_create'))
  const [hist, setHist] = useState<PurchasingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  // When fulfilling an existing reorder list, its lines are pre-filled so the
  // cashier only needs to enter receipt reference/supplier/costs and Receive.
  const [lines, setLines] = useState<DraftLine[]>(() =>
    rx && sourceList
      ? sourceList.items.map((i) => ({ ...i, key: 's:' + (i.product_id || i.name) }))
      : [],
  )
  // Delivery reference defaults to the reorder list title plus " - STK"
  // (e.g. "Reorder - 20 Sep - 01 - STK") so the delivery is traceable to the
  // list it fulfils; required in receive mode and locked when fulfilling a
  // list so the reference keeps mirroring the list name for tracking.
  const [ref, setRef] = useState(() => {
    const t = sourceList?.title || sourceList?.reference || ''
    return t ? t + ' - STK' : ''
  })
  const [title, setTitle] = useState('')
  const [supplier, setSupplier] = useState('')
  const [delivery, setDelivery] = useState('')
  const [notes, setNotes] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState(DRAFT0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openHist, setOpenHist] = useState<string | null>(null)
  useEffect(() => {
    let dead = false
    void (async () => {
      try {
        const c = await api.purchasingCatalog()
        if (!dead) { setProds(c.products); setCan(c.can_receive); setCanCreateList(c.can_reorder) }
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : 'Load failed') }
      try {
        const h = rx ? await api.consignments() : await api.reorders()
        if (!dead) setHist(h.records)
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : 'History failed') }
      // Default the reorder list title to the server-generated date reference
      // (e.g. Reorder - 20 Sep - 01). Keeps anything the cashier already typed.
      if (!rx) {
        try {
          const nr = await api.nextReorderRef()
          if (!dead) setTitle((t) => (t ? t : nr.title))
        } catch { /* offline: left empty — the server still defaults it on save */ }
      }
      if (!dead) setLoading(false)
    })()
    return () => { dead = true }
  }, [rx])

  /** Move a saved reorder list from pending to processed (from the Current Reorder Lists section). */
  async function markList(rec: PurchasingRecord, status: 'pending' | 'processed') {
    setErr('')
    try {
      await api.updateReorderStatus(rec.id, status)
      setHist((v) => v.map((x) => (x.id === rec.id ? { ...x, status } : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update status')
    }
  }
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
      unit_cost: Number(p.cost_price) || 0, selling_price: Number(p.selling_price) || 0, reorder_level: Number(p.reorder_level) || 0,
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
    if (rx && !can) { setErr('Missing permission: receive stock'); return }
    if (!draft.sku.trim() || !draft.name.trim()) { setErr('New products need SKU and name.'); return }
    // Receive mode needs the purchase price now; a reorder draft may leave it blank.
    const cost = draft.cost.trim() === '' ? (rx ? NaN : 0) : num(draft.cost)
    if (!Number.isFinite(cost) || cost < 0) { setErr('Enter a valid unit cost.'); return }
    const qty = Math.max(1, Math.floor(num(draft.qty) || 1))
    setErr('')
    const sku = draft.sku.trim().toUpperCase()
    const lvl = Math.round(num(draft.reorder) || 10)
    // The unit cost is the purchase price; the selling price is what the item
    // will retail for — required when receiving, so the new catalog row is not
    // created with a zero price.
    const sell = num(draft.sell)
    if (rx && !(sell > 0)) { setErr('Enter a selling price for the new product.'); return }
    setLines((v) => [...v, {
      key: 'n:' + Date.now(), product_id: null, sku, name: draft.name.trim(), qty, unit_cost: cost, reorder_level: lvl,
      new_product: { sku, name: draft.name.trim(), barcode: draft.barcode.trim(), category: draft.category, selling_price: rx ? sell : 0, min_stock: 5, reorder_level: lvl },
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
      if (rx && l.new_product && !(Number(l.new_product.selling_price) > 0)) { setErr('Enter a sell price for ' + l.name + '.'); return }
    }
    setBusy(true)
    try {
      const items: PurchasingItem[] = lines.map((l) => {
        const { key, ...rest } = l
        void key
        return rest
            })
      if (rx) {
        const r = await api.createConsignment({ reference: ref.trim(), supplier: supplier.trim(), delivery_cost: del, notes: notes.trim(), client_txn_id: uuid(), items, source_list_id: sourceList?.id || null })
        onDone(r.duplicate ? 'Delivery already recorded.' : 'Consignment ' + r.record.reference + ' received.')
      } else {
        const r = await api.createReorder({ title: title.trim(), notes: notes.trim(), client_txn_id: uuid(), items })
        onDone(r.duplicate ? 'Reorder list already saved.' : 'Reorder list saved.')
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); setBusy(false) }
  }
  // Current reorder lists (reorder mode) / Recent deliveries (receive mode): one shared
  // panel. In reorder mode it opens the modal - the pending lists are where
  // the cashier starts (mark one processed, then receive against it); in
  // receive mode it stays at the bottom as reference while the delivery is
  // being captured.
  const historyPanel = (
    <div className={cn('border-slate-800/70', rx ? 'mt-4 border-t pt-3' : 'mb-4 border-b pb-3')}>
      {rx && <div className="text-xs font-semibold text-slate-300 mb-2">Recent deliveries</div>}
      {loading ? <div className="text-xs text-slate-600">Loading</div> : hist.length === 0 ? <div className="text-xs text-slate-600">None yet.</div> : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {(rx ? hist : hist.filter((r) => r.status ? (r.status === 'pending' || r.status === 'processed') : !r.fulfilled)).slice(0, 20).map((r) => {
            const open = openHist === r.id
            return (
              <div key={r.id} className="text-xs text-slate-400 border border-slate-800 rounded-lg px-2.5 py-2">
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 text-left"
                  onClick={() => setOpenHist(open ? null : r.id)}
                >
                  <span className="text-white">
                    {rx ? r.reference : r.title} - {r.items.length} items
                    {!rx && (r.status === 'processed' ? ' · processed' : ' · pending')}
                  </span>
                  <span className={cn('text-slate-600 transition-transform', open && 'rotate-90')}>›</span>
                </button>
                {!open && (
                  <div className="mt-0.5 truncate">{r.items.map((i) => i.name + ' x' + i.qty).join(', ')}</div>
                )}
                {!rx && (r.status === 'pending' || !r.status) && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-500 active:bg-emerald-700 transition shadow-sm"
                      onClick={() => void markList(r, 'processed')}
                    >
                      Mark processed
                    </button>
                  </div>
                )}
                  {rx && (r.source_list_title || r.source_list_id) && (
                    <div className="mt-0.5 text-sky-300">Fulfills {r.source_list_title || 'Reorder list'}</div>
                  )}
                {open && (
                  <div className="mt-2 border-t border-slate-800/70 pt-2 space-y-1">
                    {r.items.map((i, idx) => (
                      <div key={i.product_id || `n${idx}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-slate-500">{i.sku}</span> {i.name}
                          {i.new_product && <span className="ml-1 text-[10px] text-sky-400">new</span>}
                    {rx && (r.source_list_title || r.source_list_id) && (
                      <div className="text-sky-300">Fulfills {r.source_list_title || 'Reorder list'}</div>
                    )}
                        </span>
                        <span className="text-slate-300 shrink-0">×{i.qty}{rx && i.unit_cost ? ` · ${ugx(Number(i.unit_cost) || 0)}` : ''}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-800/70 pt-1 text-slate-500">
                      <span>Total qty: {r.items.reduce((s, i) => s + i.qty, 0)}</span>
                      {rx && <span>Items total: {ugx(r.items.reduce((s, i) => s + i.qty * (Number(i.unit_cost) || 0), 0))}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-white text-lg">{rx ? 'Receive consignment' : 'Current Reorder Lists'}</h3>
            <p className="text-xs text-slate-500">{rx ? 'Stock updates immediately. New products can be created inline.' : canCreateList ? 'Lists already saved — expand one to check its items or mark it processed, then start the next list below.' : 'Lists already saved — expand one to check its items or mark it processed.'}</p>
          </div>
          <button className="btn-ghost text-xs" onClick={onClose}>Close</button>
        </div>
        {/* Reorder mode only: the current reorder lists open the modal - the cashier picks a
            pending list here (or marks one processed) before drafting a new one. */}
        {!rx && historyPanel}
        {!rx && canCreateList && (
          <div className="mb-2">
            <h3 className="font-bold text-white text-lg">Create New Reorder List</h3>
            <p className="text-xs text-slate-500">Draft what to order next — never changes stock. New products can be included.</p>
          </div>
        )}
        {!rx && canCreateList && <button type="button" className="btn-ghost text-xs mb-3" onClick={addLow}>+ Suggest low-stock items</button>}
        {rx && sourceList && (
          <p className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 mb-3">
            Fulfilling reorder list: <span className="font-medium">{sourceList.title || sourceList.reference || 'untitled'}</span>
            {sourceList.items.length} items &middot; this list will be marked fulfilled on the server once received and removed from active lists.
          </p>
        )}
        {rx && !can && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">No receive permission yet — an admin can grant “Inventory entry” in Team &amp; Codes.</p>}
        {(rx || canCreateList) && (
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          {rx ? (
            <>
              <label className="block"><span className="text-xs text-slate-400">Delivery reference *{sourceList ? ' (locked)' : ''}</span><input className="input" value={ref} onChange={sourceList ? undefined : (e) => setRef(e.target.value)} readOnly={!!sourceList} title={sourceList ? 'Locked: the delivery reference mirrors the reorder list being fulfilled' : undefined} placeholder="Delivery reference" /></label>
              <label className="block"><span className="text-xs text-slate-400">Supplier *</span><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" /></label>
              <label className="block"><span className="text-xs text-slate-400">Delivery cost (UGX)</span><input className="input" type="number" min={0} value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="Delivery cost (UGX)" /></label>
              <label className="block"><span className="text-xs text-slate-400">Note</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" /></label>
            </>
          ) : (
            <>
              <label className="block"><span className="text-xs text-slate-400">List title *</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="List title" /></label>
              <label className="block"><span className="text-xs text-slate-400">Note</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" /></label>
            </>
          )}
        </div>
        )}
        {(rx || canCreateList) && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Add existing product</div>
            <input className="input mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU" />
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {prods === null && <div className="text-xs text-slate-600 py-6 text-center">Loading</div>}
              {prods !== null && avail.length === 0 && <div className="text-xs text-slate-600 py-6 text-center">No products match.</div>}
              {avail.map((p) => (
                <button key={p.id} type="button" onClick={() => addOne(p)} className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-800 hover:border-brand-500/50">
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">{p.sku} - {p.stock_qty} in stock</div>
                    </div>
                    {/* Filled status chip, bottom-right (same StockChip language as admin) */}
                    <span
                      title={p.stock_qty === 0 ? 'Out of stock' : `${p.stock_qty} in stock${p.stock_qty <= p.reorder_level ? ' (low)' : ''}`}
                      className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 shrink-0',
                        p.stock_qty === 0 ? 'bg-red-400' : p.stock_qty <= p.reorder_level ? 'bg-orange-400' : 'bg-emerald-400',
                      )}
                    >
                      {p.stock_qty === 0 ? 'Out' : p.stock_qty <= p.reorder_level ? 'Low' : 'OK'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {(!rx || can) && (
              <button type="button" className="btn-ghost text-xs w-full mt-2" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Hide new product' : '+ New product'}</button>
            )}
            {showNew && (!rx || can) && (
              <div className="mt-2 space-y-2 border-t border-slate-800/70 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="SKU" />
                  <input className="input" value={draft.barcode} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} placeholder="Barcode" />
                </div>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Product name" />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as (typeof CATS)[number] })}>
                    <option value="">— Select category —</option>
                    {CATS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input className="input" type="number" min={0} value={draft.reorder} onChange={(e) => setDraft({ ...draft, reorder: e.target.value })} placeholder="Reorder level" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="number" min={0} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} placeholder="Unit cost (UGX)" />
                  <input className="input" type="number" min={1} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder="Quantity" />
                </div>
                {rx && (
                  <input className="input border-brand-500/40" type="number" min={1} value={draft.sell} onChange={(e) => setDraft({ ...draft, sell: e.target.value })} placeholder="Selling price (UGX) *" />
                )}
                <button type="button" className="btn-primary text-xs w-full" onClick={addNew}>{rx ? 'Add to delivery' : 'Add to list'}</button>
              </div>
            )}
          </div>
          <div className="card p-3">
            <div className="text-xs font-semibold text-slate-300 mb-2">Current draft</div>
            {lines.length === 0 && <div className="text-xs text-slate-600 py-8 text-center">Nothing added yet.</div>}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {lines.map((l) => (
                <div key={l.key} className={cn('rounded-xl p-2.5 border', l.new_product ? 'bg-gradient-to-br from-brand-500/15 to-transparent border-brand-500/30' : 'border-slate-800')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="text-sm text-white truncate">{l.name}</div><div className="text-[11px] text-slate-500 font-mono">{l.sku}</div></div>
                    <button type="button" className="text-slate-600 hover:text-red-400 text-xs" onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}>X</button>
                  </div>
                  <div className="grid gap-2 mt-2 grid-cols-2">
                    <label className="block"><span className="text-[11px] text-slate-500">Qty</span><input className="input" type="number" min={1} value={String(l.qty)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x))} /></label>
                     <label className="block"><span className="text-[11px] text-slate-500">Unit cost</span><input className="input" type="number" min={0} value={String(l.unit_cost)} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key ? { ...x, unit_cost: Number(e.target.value) || 0 } : x))} /></label>
                  </div>
                  {rx && l.new_product && (
                    <label className="block mt-2">
                      <span className="text-[11px] text-brand-300">Selling price (UGX) *</span>
                      <input className="input" type="number" min={1} value={l.new_product.selling_price ? String(l.new_product.selling_price) : ''} onChange={(e) => setLines((v) => v.map((x) => x.key === l.key && x.new_product ? { ...x, new_product: { ...x.new_product, selling_price: Number(e.target.value) || 0 } } : x))} />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {rx && lines.length > 0 && <div className="text-xs text-slate-400 mt-2"><div className="flex justify-between"><span>Landed total</span><span className="text-brand-300 font-semibold">{ugx(itemsTotal + (Number.isFinite(del) ? del : 0))}</span></div></div>}
          </div>
        </div>
        )}
        {err && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">{err}</p>}
        {(rx || canCreateList) && (
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || (rx && !can)} onClick={() => void save()}>{busy ? 'Saving' : rx ? 'Receive stock' : 'Save reorder'}</button>
          </div>
        )}
        {rx && historyPanel}
      </div>
    </div>
  )
}
