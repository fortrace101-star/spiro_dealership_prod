import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, num, ugx } from '../lib/format'
import type { Product, StockMovement } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'

const EMPTY_FORM = { sku: '', barcode: '', name: '', category: 'Spare part', brand: '', supplier: '', cost_price: '', selling_price: '', stock_qty: '', min_stock: '5', reorder_level: '10' }

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [q, setQ] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState<Product | null>(null)
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [movements, setMovements] = useState<StockMovement[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await api.products(q, lowOnly)
    setProducts(r.products)
  }, [q, lowOnly])

  useEffect(() => {
    load().catch(() => setProducts([]))
  }, [load])

  function openNew() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setShowForm(true)
    setError('')
  }

  function openEdit(p: Product) {
    setForm({
      sku: p.sku, barcode: p.barcode || '', name: p.name, category: p.category, brand: p.brand || '',
      supplier: p.supplier || '', cost_price: String(p.cost_price), selling_price: String(p.selling_price),
      stock_qty: String(p.stock_qty), min_stock: String(p.min_stock), reorder_level: String(p.reorder_level),
    })
    setEditing(p)
    setShowForm(true)
    setError('')
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const payload = {
      ...form,
      cost_price: Number(form.cost_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      stock_qty: Number(form.stock_qty) || 0,
      min_stock: Number(form.min_stock) || 5,
      reorder_level: Number(form.reorder_level) || 10,
    }
    try {
      if (editing) await api.updateProduct(editing.id, payload)
      else await api.createProduct(payload)
      setShowForm(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function showMovements(p: Product) {
    setAdjusting(null)
    const r = await api.movements(p.id)
    setMovements(r.movements)
  }

  return (
    <div>
      <PageHeader
        title="Spare Parts Inventory"
        subtitle="Stock levels, reorder alerts and movement history"
        actions={<button className="btn-primary" onClick={openNew}>+ Add product</button>}
      />

      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input className="input max-w-xs" placeholder="Search name, SKU, barcode…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="accent-brand-500" />
          Low stock only
        </label>
        {products && <span className="text-sm text-slate-500 ml-auto">{products.length} products</span>}
      </div>

      <div className="card overflow-hidden">
        {products === null ? (
          <Spinner />
        ) : products.length === 0 ? (
          <EmptyState message="No products found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Category</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">Margin</th>
                  <th className="th text-right">Stock</th>
                  <th className="th">Status</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const margin = Number(p.selling_price) > 0 ? ((Number(p.selling_price) - Number(p.cost_price)) / Number(p.selling_price)) * 100 : 0
                  const isLow = p.stock_qty <= p.reorder_level
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30">
                      <td className="td">
                        <div className="font-medium text-white">{p.name}</div>
                        <div className="text-xs text-slate-500 font-mono">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</div>
                      </td>
                      <td className="td text-slate-400 text-xs">{p.category}</td>
                      <td className="td text-right text-slate-400">{ugx(p.cost_price)}</td>
                      <td className="td text-right">{ugx(p.selling_price)}</td>
                      <td className="td text-right text-brand-300">{margin.toFixed(0)}%</td>
                      <td className="td text-right font-semibold">{num(p.stock_qty)}</td>
                      <td className="td">
                        {p.stock_qty === 0 ? <Badge kind="credit">Out</Badge> : isLow ? <Badge kind="pending">Low</Badge> : <Badge kind="in_stock">OK</Badge>}
                      </td>
                      <td className="td text-right whitespace-nowrap">
                        <button className="btn-ghost text-xs px-2 py-1" onClick={() => openEdit(p)}>Edit</button>
                        <button className="btn-ghost text-xs px-2 py-1 ml-1" onClick={() => showMovements(p)}>History</button>
                        <button className="btn-ghost text-xs px-2 py-1 ml-1" onClick={() => { setAdjusting(p); setMovements(null) }}>Adjust</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {showForm && (
        <Modal title={editing ? `Edit ${editing.name}` : 'Add product'} onClose={() => setShowForm(false)}>
          <form onSubmit={saveProduct} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU *"><input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required /></Field>
              <Field label="Barcode"><input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></Field>
            </div>
            <Field label="Name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option>Spare part</option><option>Accessory</option><option>Consumable</option>
                </select>
              </Field>
              <Field label="Brand"><input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label="Supplier"><input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Cost (UGX)"><input className="input" type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
              <Field label="Sell price (UGX)"><input className="input" type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} /></Field>
              <Field label={editing ? 'Stock (use Adjust)' : 'Opening qty'}>
                <input className="input" type="number" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} disabled={!!editing} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min stock"><input className="input" type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /></Field>
              <Field label="Reorder level"><input className="input" type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></Field>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary">{editing ? 'Save changes' : 'Add product'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Adjust modal */}
      {adjusting && (
        <AdjustModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); load() }}
        />
      )}

      {/* Movements drawer */}
      {movements && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setMovements(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-md h-full bg-[#12161d] border-l border-slate-800 p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Stock movements</h3>
              <button className="btn-ghost text-xs" onClick={() => setMovements(null)}>Close</button>
            </div>
            {movements.length === 0 ? (
              <EmptyState message="No movements recorded." />
            ) : (
              <div className="space-y-2">
                {movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between bg-[#0b0e13] rounded-xl px-3 py-2.5 border border-slate-800/60">
                    <div>
                      <div className="text-sm text-white">
                        <span className={m.qty > 0 ? 'text-brand-300 font-semibold' : 'text-red-300 font-semibold'}>
                          {m.qty > 0 ? '+' : ''}{m.qty}
                        </span>{' '}
                        <span className="text-slate-400 capitalize">{m.type}</span>
                      </div>
                      <div className="text-[11px] text-slate-600">{m.product_name} · {dateTime(m.created_at)}{m.user_name ? ` · ${m.user_name}` : ''}</div>
                    </div>
                    {m.note && <div className="text-xs text-slate-500 max-w-[120px] truncate">{m.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AdjustModal({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [type, setType] = useState('adjustment')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseInt(qty, 10)
    if (!Number.isInteger(n) || n === 0) {
      setError('Enter a non-zero quantity (negative to remove stock)')
      return
    }
    setBusy(true)
    try {
      await api.adjustStock(product.id, n, note, type)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Adjust stock — ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm text-slate-400">Current stock: <span className="text-white font-semibold">{product.stock_qty}</span></div>
        <Field label="Quantity (+ to add, − to remove)"><input className="input" placeholder="e.g. -2 or 10" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="adjustment">Adjustment</option>
              <option value="purchase">Purchase (restock)</option>
              <option value="workshop">Used in workshop</option>
              <option value="damaged">Damaged</option>
              <option value="transfer">Transfer</option>
              <option value="return">Customer return</option>
            </select>
          </Field>
          <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason…" /></Field>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Apply adjustment'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">{title}</h3>
          <button className="text-slate-500 hover:text-white text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400 mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}
