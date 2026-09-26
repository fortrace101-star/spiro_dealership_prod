import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { db } from '../db/database'
import type { Product } from '../lib/types'
import { PRODUCT_CATEGORIES } from '../lib/api'

/** Product editor modal for POS terminals with the `product_edit` grant. */
type Props = {
  productId: string
  onClose: () => void
  onDone: (msg: string) => void
}

export default function EditProductsModal({ productId, onClose, onDone }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    db.products.get(productId).then((p) => {
      if (p) setProduct(p)
      setLoading(false)
    })
  }, [productId])

  if (loading) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Loading…</div></div>
  if (!product) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Product not found.</div></div>

  const patch = { ...product }
  const categories = PRODUCT_CATEGORIES

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white text-lg mb-4">Edit: {product.name}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400">SKU</label>
            <input className="input w-full" value={patch.sku} onChange={(e) => setProduct({ ...patch, sku: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Name</label>
            <input className="input w-full" value={patch.name} onChange={(e) => setProduct({ ...patch, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Barcode</label>
            <input className="input w-full" value={patch.barcode || ''} onChange={(e) => setProduct({ ...patch, barcode: e.target.value || null })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Category</label>
            <select className="input w-full" value={patch.category} onChange={(e) => setProduct({ ...patch, category: e.target.value })}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Brand</label>
            <input className="input w-full" value={patch.brand || ''} onChange={(e) => setProduct({ ...patch, brand: e.target.value || null })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Supplier</label>
            <input className="input w-full" value={patch.supplier || ''} onChange={(e) => setProduct({ ...patch, supplier: e.target.value || null })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Cost price</label>
            <input className="input w-full" type="number" value={patch.cost_price} onChange={(e) => setProduct({ ...patch, cost_price: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Selling price</label>
            <input className="input w-full" type="number" value={patch.selling_price} onChange={(e) => setProduct({ ...patch, selling_price: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Min stock</label>
            <input className="input w-full" type="number" value={patch.min_stock} onChange={(e) => setProduct({ ...patch, min_stock: Number(e.target.value) })} />
          </div>
          <div>
            <label className="text-xs text-slate-400">Reorder level</label>
            <input className="input w-full" type="number" value={patch.reorder_level} onChange={(e) => setProduct({ ...patch, reorder_level: Number(e.target.value) })} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={patch.active !== false} onChange={(e) => setProduct({ ...patch, active: e.target.checked })} />
            <label className="text-xs text-slate-400">Active</label>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost text-xs" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary text-xs"
            disabled={saving}
            onClick={async () => {
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
                onDone(`Updated "${patch.name}"`)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Save failed')
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
