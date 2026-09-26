import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { db } from '../db/database'
import type { Product } from '../lib/types'

/** Inventory adjustment modal for POS terminals with the `inventory_adjust` grant. */
type Props = {
  productId: string
  onClose: () => void
  onDone: (msg: string) => void
}

export default function AdjustInventoryModal({ productId, onClose, onDone }: Props) {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [type, setType] = useState<'adjustment' | 'damaged' | 'transfer' | 'return'>('adjustment')

  useEffect(() => {
    db.products.get(productId).then((p) => {
      if (p) setProduct(p)
      setLoading(false)
    })
  }, [productId])

  if (loading) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Loading…</div></div>
  if (!product) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div className="card p-6">Product not found.</div></div>

  const delta = Number(qty)
  const newQty = product.stock_qty + delta
  const isValid = Number.isInteger(delta) && delta !== 0 && newQty >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-white text-lg mb-4">Adjust: {product.name}</h3>
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
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost text-xs" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary text-xs"
            disabled={saving || !isValid}
            onClick={async () => {
              setSaving(true)
              setError('')
              try {
                // Optimistic local update
                await db.products.where('id').equals(productId).modify((p: Product) => {
                  p.stock_qty = newQty
                })
                setProduct({ ...product, stock_qty: newQty })
                // Server sync (re-checked permissions server-side)
                await api.adjustInventory(productId, delta, note || undefined, type)
                onDone(`Adjusted stock: ${product.stock_qty} → ${newQty}`)
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
