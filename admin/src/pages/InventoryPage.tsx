import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { compactUgx, dateTime, num, ugx } from '../lib/format'
import type { Product, StockMovement } from '../lib/types'
import { EmptyState, PageHeader, Spinner, stockStatusMeta } from '../components/ui'
import { cn } from '../lib/cn'
import { usePageSize } from '../lib/usePageSize'

const EMPTY_FORM = { sku: '', barcode: '', name: '', category: 'Spare Parts', brand: '', supplier: '', cost_price: '', selling_price: '', stock_qty: '', min_stock: '5', reorder_level: '10' }

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
  const [detail, setDetail] = useState<Product | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    const r = await api.products(q, lowOnly)
    setProducts(r.products)
  }, [q, lowOnly])

  useEffect(() => {
    setPage(1) // reset page when a filter changes (pagination gotcha)
    load().catch(() => setProducts([]))
  }, [load])

  const totalPages = Math.max(1, Math.ceil((products?.length || 0) / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = (products || []).slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeFrom = (products?.length || 0) === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeTo = Math.min(safePage * pageSize, products?.length || 0)

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
        title="Inventory"
        subtitle="Stock levels, reorder alerts and movement history"
        actions={<button className="btn-primary" onClick={openNew}>+ Add product</button>}
      />

      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input className="input w-full sm:max-w-xs" placeholder="Search name, SKU, barcode…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <th className="th col-opt">Category</th>
                  {/* Phones: one stacked Cost/Price cell; sm+: separate columns */}
                  <th className="th text-right sm:hidden">
                    <div className="text-slate-400">Cost</div>
                    <div className="border-t border-slate-800/80 my-1" />
                    <div className="text-slate-200">Price</div>
                  </th>
                  <th className="th col-opt text-right">Cost</th>
                  <th className="th col-opt text-right">Price</th>
                  <th className="th text-right">Margin</th>
                  <th className="th text-right">Stock</th>
                  <th className="th col-opt">Status</th>
                  <th className="th col-opt"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => {
                  const margin = Number(p.selling_price) > 0 ? ((Number(p.selling_price) - Number(p.cost_price)) / Number(p.selling_price)) * 100 : 0
                  const isLow = p.stock_qty <= p.reorder_level
                  const stockColor = p.stock_qty === 0 ? 'text-red-400' : isLow ? 'text-orange-400' : 'text-emerald-400'
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => setDetail(p)}>
                      <td className="td">
                        <div className="font-medium text-white">{p.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{p.sku}</div>
                      </td>
                      <td className="td col-opt text-slate-400 text-xs">{p.category}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap sm:hidden">
                        <div className="text-slate-400">
                          <span className="sm:hidden">{compactUgx(p.cost_price)}</span>
                          <span className="hidden sm:inline">{ugx(p.cost_price)}</span>
                        </div>
                        <div className="border-t border-slate-800/80 my-1" />
                        <div>
                          <span className="sm:hidden">{compactUgx(p.selling_price)}</span>
                          <span className="hidden sm:inline">{ugx(p.selling_price)}</span>
                        </div>
                      </td>
                      <td className="td col-opt text-right text-slate-400 tabular-nums whitespace-nowrap">{ugx(p.cost_price)}</td>
                      <td className="td col-opt text-right tabular-nums whitespace-nowrap">{ugx(p.selling_price)}</td>
                      <td className="td text-right text-brand-300 tabular-nums">{margin.toFixed(0)}%</td>
                      <td className={cn('td text-right font-semibold tabular-nums', stockColor)}>
                        {num(p.stock_qty)}
                        <span className="sm:hidden text-slate-600 text-xs ml-2">›</span>
                      </td>
                      <td className="td col-opt">
                        {p.stock_qty === 0 ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-red-400">
                            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                            Out
                          </span>
                        ) : isLow ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-orange-400">
                            <span className="h-2.5 w-2.5 rounded-full bg-orange-400" />
                            Low
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                            OK
                          </span>
                        )}
                      </td>
                      <td className="td col-opt text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-ghost text-xs px-2 py-1" onClick={() => openEdit(p)}>Edit</button>
                        <button className="btn-ghost text-xs px-2 py-1 ml-1" onClick={() => showMovements(p)}>History</button>
                        <button className="btn-ghost text-xs px-2 py-1 ml-1" onClick={() => { setAdjusting(p); setMovements(null) }}>Adjust</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* Mobile-only key: the Status column (which carries these colors) is sm+ only */}
            <div className="sm:hidden px-4 py-3 border-t border-slate-800/60 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />OK — in stock</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />Low — at/below reorder level</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />Out — zero stock</span>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {products && products.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-slate-500">Showing {rangeFrom}–{rangeTo} of {products.length}</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <span className="text-slate-400 text-xs">Page {safePage} of {totalPages}</span>
            <button className="btn-ghost text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        </div>
      )}

      {/* Product detail drawer (Rule 2: home for the col-opt columns) */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="font-medium text-white text-lg">{detail.name}</div>
                <div className="text-xs text-slate-500 font-mono">{detail.sku}{detail.barcode ? ` · ${detail.barcode}` : ''}</div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Selling price</div>
                <div className="text-base font-semibold text-white">{ugx(detail.selling_price)}</div>
              </div>
              <div className={cn('bg-[#0b0e13] rounded-xl p-3 border', stockStatusMeta(detail.stock_qty, detail.reorder_level).card)}>
                <div className="text-xs text-slate-500 mb-1">Stock on hand</div>
                <div className="flex items-end justify-between gap-2">
                  <div className="text-base font-semibold text-white">{num(detail.stock_qty)}</div>
                  <span className={cn('text-[10px] font-semibold', stockStatusMeta(detail.stock_qty, detail.reorder_level).text)}>
                    {stockStatusMeta(detail.stock_qty, detail.reorder_level).label}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-6">
              <Info label="Category" value={detail.category} />
              <Info label="Brand" value={detail.brand || '—'} />
              <Info label="Supplier" value={detail.supplier || '—'} />
              <Info label="Cost price" value={ugx(detail.cost_price)} />
              <Info label="Margin" value={Number(detail.selling_price) > 0 ? `${(((Number(detail.selling_price) - Number(detail.cost_price)) / Number(detail.selling_price)) * 100).toFixed(0)}%` : '—'} />
              <Info label="Stock value" value={detail.stock_value != null ? ugx(detail.stock_value) : ugx(Number(detail.cost_price) * detail.stock_qty)} />
              <Info label="Min stock" value={num(detail.min_stock)} />
              <Info label="Reorder level" value={num(detail.reorder_level)} />
              <Info label="Status" value={detail.stock_qty === 0 ? 'Out of stock' : detail.stock_qty <= detail.reorder_level ? 'Low stock' : 'In stock'} />
              <Info label="Last updated" value={dateTime(detail.updated_at)} />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost w-full sm:w-auto" onClick={() => showMovements(detail)}>Movement history</button>
              <button
                className="btn-ghost w-full sm:w-auto"
                onClick={() => { const p = detail; setDetail(null); setAdjusting(p) }}
              >
                Adjust stock
              </button>
              <button
                className="btn-primary w-full sm:w-auto"
                onClick={() => { const p = detail; setDetail(null); openEdit(p) }}
              >
                Edit product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <Modal title={editing ? `Edit ${editing.name}` : 'Add product'} onClose={() => setShowForm(false)}>
          <form onSubmit={saveProduct} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="SKU *"><input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required /></Field>
              <Field label="Barcode"><input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></Field>
            </div>
            <Field label="Name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <optgroup label="I.C.E Bike Spare Parts &amp; Accessories">
                    <option>Spare Parts</option>
                    <option>Accessories</option>
                    <option>Consumables</option>
                  </optgroup>
                  <optgroup label="e-Bikes Spare Parts">
                    <option>e-Bikes Spare Parts</option>
                  </optgroup>
                </select>
              </Field>
              <Field label="Brand"><input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label="Supplier"><input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Cost (UGX)"><input className="input" type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
              <Field label="Sell price (UGX)"><input className="input" type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} /></Field>
              <Field label={editing ? 'Stock (use Adjust)' : 'Opening qty'}>
                <input className="input" type="number" value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} disabled={!!editing} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Min stock"><input className="input" type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /></Field>
              <Field label="Reorder level"><input className="input" type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} /></Field>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary w-full sm:w-auto">{editing ? 'Save changes' : 'Add product'}</button>
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
          <div className="relative w-full max-w-md h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm sm:text-base font-semibold text-white">Stock movements</h3>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-ghost w-full sm:w-auto" onClick={onClose}>Cancel</button>
          <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? 'Saving…' : 'Apply adjustment'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative card w-full max-w-[98vw] sm:max-w-3xl rounded-b-none sm:rounded-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base sm:text-lg font-semibold text-white truncate">{title}</h3>
          <button className="text-slate-500 hover:text-white text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="text-xs font-medium text-slate-400 mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

/** Label/value row used inside detail drawers. */
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-white break-words">{value}</div>
    </div>
  )
}
