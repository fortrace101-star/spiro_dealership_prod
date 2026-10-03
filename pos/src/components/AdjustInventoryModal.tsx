import { useEffect, useState } from 'react'
import { api, PRODUCT_CATEGORIES } from '../lib/api'
import { cn } from '../lib/cn'
import { db } from '../db/database'
import type { Product } from '../lib/types'

/**
 * Single stock modal for POS terminals: product details (absorbed from the
 * retired Edit Products modal) + a stock adjustment in one place.
 * Gated by `canEdit` (the `inventory_adjust` grant now covers editing too).
 * The footer Cancel is orange (btn-warn) — it aborts a *live* mode.
 */
type Props = {
  productId: string
  /** Whether the operator may edit product details (adjust grant). */
  canEdit: boolean
  onClose: () => void
  onDone: (msg: string) => void
}

export default function AdjustInventoryModal({ productId, canEdit, onClose, onDone }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Adjustment fields
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [type, setType] = useState<'adjustment' | 'damaged' | 'transfer' | 'return'>('adjustment')
  // Two tabs within one modal: stock adjustment (live mode) vs. product details.
  const [tab, setTab] = useState<'adjust' | 'edit'>('adjust')

  useEffect(() => {
    db.products.get(productId).then((p) => {
      if (p) setProduct(p)
      setLoading(false)
    })
  }, [productId])

  if (loading) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Loading…</div></div>
  if (!product) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Product not found.</div></div>

  // Working copy for the editable detail fields (same pattern the retired
  // Edit Products modal used: the patch starts as the loaded product).
  const patch = { ...product }
  const set = (p: Partial<Product>) => setProduct({ ...patch, ...p })

  const delta = Number(qty)
  const newQty = product.stock_qty + delta
  const isValid = Number.isInteger(delta) && delta !== 0 && newQty >= 0

  async function saveDetails() {
    setSaving(true)
    setError('')
    try {
      await db.products.put(patch as Product)
      await api.updateProduct(productId, {
        sku: patch.sku, barcode: patch.barcode, name: patch.name,
        category: patch.category, brand: patch.brand, supplier: patch.supplier,
        cost_price: patch.cost_price, selling_price: patch.selling_price,
        min_stock: patch.min_stock, reorder_level: patch.reorder_level, active: patch.active,
      })
      setProduct({ ...patch })
      onDone(`Updated "${patch.name}"`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function applyAdjustment() {
    setSaving(true)
    setError('')
    try {
      // Optimistic local update
      await db.products.where('id').equals(productId).modify((p: Product) => {
        p.stock_qty = newQty
      })
      setProduct({ ...patch, stock_qty: newQty })
      // Server sync (re-checked permissions server-side)
      await api.adjustInventory(productId, delta, note || undefined, type)
      onDone(`Adjusted stock: ${patch.stock_qty} → ${newQty}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

    return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white text-lg mb-4">Adjust: {product.name}</h3>

        {/* Two tabs within one modal: stock adjustment vs. product details. */}
        {canEdit && (
          <div className="flex gap-1 mb-4 bg-slate-800/40 p-1 rounded-lg">
            <button
              type="button"
              className={cn(
                'flex-1 text-xs font-semibold py-2 rounded-md transition-colors',
                tab === 'adjust' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-300',
              )}
              onClick={() => setTab('adjust')}
            >
              Adjust inventory
            </button>
            <button
              type="button"
              className={cn(
                'flex-1 text-xs font-semibold py-2 rounded-md transition-colors',
                tab === 'edit' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-300',
              )}
              onClick={() => setTab('edit')}
            >
              Edit product
            </button>
          </div>
        )}
        {canEdit && tab === 'edit' && (
          <div className="mb-5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Product details</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">SKU</label>
                <input className="input w-full" value={patch.sku} onChange={(e) => set({ sku: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Barcode</label>
                <input className="input w-full" value={patch.barcode || ''} onChange={(e) => set({ barcode: e.target.value || null })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-400">Name</label>
                <input className="input w-full" value={patch.name} onChange={(e) => set({ name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Category</label>
                <select className="input w-full" value={patch.category} onChange={(e) => set({ category: e.target.value })}>
                  {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Brand</label>
                <input className="input w-full" value={patch.brand || ''} onChange={(e) => set({ brand: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Supplier</label>
                <input className="input w-full" value={patch.supplier || ''} onChange={(e) => set({ supplier: e.target.value || null })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Cost price</label>
                <input className="input w-full" type="number" value={patch.cost_price} onChange={(e) => set({ cost_price: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Selling price</label>
                <input className="input w-full" type="number" value={patch.selling_price} onChange={(e) => set({ selling_price: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Min stock</label>
                <input className="input w-full" type="number" value={patch.min_stock} onChange={(e) => set({ min_stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Reorder level</label>
                <input className="input w-full" type="number" value={patch.reorder_level} onChange={(e) => set({ reorder_level: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={patch.active !== false} onChange={(e) => set({ active: e.target.checked })} />
                <label className="text-xs text-slate-400">Active</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-warn text-xs" onClick={onClose}>Cancel</button>
              <button className="btn-primary text-xs" disabled={saving} onClick={() => void saveDetails()}>
                {saving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </div>
        )}
        {/* ---- Stock adjustment ---- */}
        <div hidden={tab !== 'adjust'} className={canEdit ? 'border-t border-slate-800 pt-4' : ''}>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Stock adjustment</div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400">Current stock</label>
              <div className="text-lg font-semibold text-white">{product.stock_qty}</div>
            </div>
            <div>
              <label className="text-xs text-slate-400">Change (±)</label>
              <input
                className="input w-full"
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. +5 or -2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Type</label>
              <select className="input w-full" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="adjustment">Adjustment</option>
                <option value="damaged">Damaged</option>
                <option value="transfer">Transfer</option>
                <option value="return">Return</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Note (optional)</label>
              <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this adjustment?" />
            </div>
            {!isValid && delta !== 0 && (
              <p className="text-xs text-red-400">Resulting stock would be negative ({newQty})</p>
            )}
          </div>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-warn text-xs" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary text-xs"
              disabled={saving || !isValid}
              onClick={() => void applyAdjustment()}
            >
              {saving ? 'Saving…' : 'Apply adjustment'}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>
    </div>
  )
}
