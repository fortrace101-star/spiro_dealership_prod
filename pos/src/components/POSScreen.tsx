import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { createSale, getTodaySales } from '../db/repos'
import { clearSession, getDeviceId, getStoredUser } from '../lib/api'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { useSyncStatus } from '../hooks/useSyncStatus'
import { runSyncCycle } from '../services/sync'
import { cartTotals, useCart } from '../store/cart'
import { PAYMENT_LABELS, type Bike, type LocalSale, type PaymentMethod, type Product } from '../lib/types'
import { ugx } from '../lib/format'
import CheckoutModal from './CheckoutModal'
import ReceiptModal from './ReceiptModal'
import HistoryModal from './HistoryModal'
import { cn } from '../lib/cn'

export default function POSScreen() {
  const user = getStoredUser()!
  const sync = useSyncStatus()
  const cart = useCart()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [tab, setTab] = useState<'parts' | 'bikes'>('parts')
  const [showCheckout, setShowCheckout] = useState(false)
  const [receipt, setReceipt] = useState<LocalSale | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const bikes = useLiveQuery(() => db.bikes.where('status').equals('in_stock').toArray(), [])
  const todays = useLiveQuery(() => getTodaySales(), [])

  const todayStats = useMemo(() => {
    const list = todays || []
    return {
      count: list.length,
      revenue: list.reduce((s, x) => s + x.total, 0),
      pending: list.filter((x) => x.status === 'pending_sync').length,
    }
  }, [todays])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (tab === 'bikes') {
      return (bikes || []).filter((b) => !q || b.model.toLowerCase().includes(q) || b.vin.toLowerCase().includes(q))
    }
    return (products || []).filter(
      (p) =>
        (category === 'All' || p.category === category) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q)),
    )
  }, [tab, products, bikes, search, category])

  const addProduct = useCallback(
    (p: Product, qty = 1) => {
      cart.addItem({ kind: 'part', id: p.id, name: p.name, sku: p.sku, unit_price: Number(p.selling_price), unit_cost: Number(p.cost_price), stock_qty: p.stock_qty }, qty)
      setFlash(`${p.name} added`)
    },
    [cart],
  )

  const addBike = useCallback(
    (b: Bike) => {
      cart.addItem({ kind: 'bike', id: b.id, name: `${b.model}${b.color ? ` · ${b.color}` : ''}`, sku: b.vin, unit_price: Number(b.selling_price), unit_cost: Number(b.cost_price), stock_qty: 1 })
      setFlash(`${b.model} added`)
    },
    [cart],
  )

  // Barcode scanner → local IndexedDB lookup (never a network round trip)
  useBarcodeScanner(
    useCallback(
      async (code: string) => {
        const p = await db.products.where('barcode').equals(code).first()
        if (p) {
          addProduct(p)
          return
        }
        const b = await db.bikes.where('vin').equals(code).first()
        if (b && b.status === 'in_stock') {
          addBike(b)
          return
        }
        setSearch(code) // fall back to manual search
        setFlash(`No product with barcode ${code}`)
      },
      [addProduct, addBike],
    ),
  )

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  const totals = cartTotals(cart.items, cart.discount)

  async function completeCheckout(input: { discount: number; payment_method: PaymentMethod; amount_paid: number; customer_name: string | null; customer_phone: string | null }) {
    const sale = await createSale({
      cashier_id: user.id,
      cashier_name: user.full_name,
      device_id: getDeviceId(),
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      discount: input.discount,
      payment_method: input.payment_method,
      amount_paid: input.amount_paid,
      items: cart.items.map((i) => ({
        product_id: i.kind === 'part' ? i.id : null,
        bike_id: i.kind === 'bike' ? i.id : null,
        name: i.name,
        kind: i.kind,
        qty: i.qty,
        unit_price: i.unit_price,
        unit_cost: i.unit_cost,
        line_total: i.unit_price * i.qty,
      })),
    })

    // Optimistic local stock deduction so the UI reflects reality offline
    for (const i of cart.items) {
      if (i.kind === 'part') {
        await db.products.where('id').equals(i.id).modify((p: Product) => {
          p.stock_qty = Math.max(0, p.stock_qty - i.qty)
        })
      } else {
        await db.bikes.where('id').equals(i.id).modify((b: Bike) => {
          b.status = 'sold'
        })
      }
    }

    cart.clearCart()
    setShowCheckout(false)
    setReceipt(sale)
    // Fire an immediate sync attempt (works when online; harmless when offline)
    void runSyncCycle('after-sale')
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <header className="h-14 shrink-0 border-b border-slate-800/70 flex items-center px-4 gap-4 bg-[#0e1512]">
        <img src="/logo.png" alt="Spiro" className="h-8 w-8 object-contain" />
        <div>
          <div className="text-sm font-bold text-white leading-tight">Spiro POS</div>
          <div className="text-[10px] text-slate-500">{getDeviceId()} · {user.full_name}</div>
        </div>

        <div
          className={cn(
            'ml-6 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border',
            sync.online ? 'bg-brand-500/10 text-brand-300 border-brand-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', sync.online ? 'bg-brand-400' : 'bg-amber-400 animate-pulse')} />
          {sync.online ? 'Online' : 'Offline — selling continues'}
        </div>

        {sync.pendingCount > 0 && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full font-semibold">
            {sync.pendingCount} sale{sync.pendingCount > 1 ? 's' : ''} queued for sync
          </div>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span>Today: <span className="text-white font-semibold">{todayStats.count}</span> sales · <span className="text-brand-300 font-semibold">{ugx(todayStats.revenue)}</span></span>
          <button className="btn-ghost text-xs" onClick={() => setShowHistory(true)}>History</button>
          <button className="btn-ghost text-xs" onClick={() => void runSyncCycle('manual')} disabled={sync.syncing}>
            {sync.syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="btn-ghost text-xs" onClick={() => { clearSession(); location.reload() }}>Sign out</button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: catalog */}
        <section className="flex-1 flex flex-col min-w-0 p-4 gap-3">
          <div className="flex gap-2">
            <button className={tab === 'parts' ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setTab('parts')}>Spare parts & accessories</button>
            <button className={tab === 'bikes' ? 'btn-primary text-xs' : 'btn-ghost text-xs'} onClick={() => setTab('bikes')}>Bikes 🛵</button>
          </div>

          <input
            className="input"
            placeholder={tab === 'parts' ? 'Search name / SKU — or just scan a barcode…' : 'Search model or VIN…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {tab === 'parts' && (
            <div className="flex gap-1.5 flex-wrap">
              {['All', ...(categories || [])].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition',
                    category === c ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'text-slate-400 border-slate-800 hover:border-slate-600',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {tab === 'parts' ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {(filtered as Product[]).map((p) => {
                  const out = p.stock_qty <= 0
                  return (
                    <button
                      key={p.id}
                      disabled={out}
                      onClick={() => addProduct(p)}
                      className={cn(
                        'card p-3 text-left hover:border-brand-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed',
                        out && 'hover:border-slate-800',
                      )}
                    >
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{p.category}</div>
                      <div className="text-sm font-semibold text-white mt-0.5 leading-snug line-clamp-2">{p.name}</div>
                      <div className="flex items-end justify-between mt-2">
                        <span className="text-brand-300 font-bold text-sm">{ugx(p.selling_price)}</span>
                        <span className={cn('text-[10px]', p.stock_qty <= p.reorder_level ? 'text-amber-400' : 'text-slate-500')}>
                          {out ? 'Out of stock' : `${p.stock_qty} in stock`}
                        </span>
                      </div>
                    </button>
                  )
                })}
                {filtered.length === 0 && <div className="col-span-full text-center text-sm text-slate-600 py-10">No products match. Sync when online to refresh catalog.</div>}
              </div>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
                {(filtered as Bike[]).map((b) => (
                  <button key={b.id} onClick={() => addBike(b)} className="card p-4 text-left hover:border-brand-500/50 transition">
                    <div className="text-sm font-bold text-white">{b.model}</div>
                    <div className="text-xs text-slate-500">{b.color} {b.year ? `· ${b.year}` : ''}</div>
                    <div className="text-[10px] font-mono text-slate-600 mt-1">{b.vin}</div>
                    <div className="text-brand-300 font-bold mt-2">{ugx(b.selling_price)}</div>
                    {b.battery_spec && <div className="text-[10px] text-slate-500 mt-1">🔋 {b.battery_spec}</div>}
                  </button>
                ))}
                {filtered.length === 0 && <div className="col-span-full text-center text-sm text-slate-600 py-10">No bikes available in local catalog.</div>}
              </div>
            )}
          </div>
        </section>

        {/* Right: cart */}
        <aside className="w-[380px] shrink-0 border-l border-slate-800/70 bg-[#0e1512] flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800/70 flex items-center justify-between">
            <h2 className="font-semibold text-white text-sm">Cart · {cart.items.length} item{cart.items.length !== 1 ? 's' : ''}</h2>
            {cart.items.length > 0 && <button className="text-xs text-slate-500 hover:text-red-300" onClick={() => cart.clearCart()}>Clear</button>}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.items.length === 0 && (
              <div className="text-center text-sm text-slate-600 py-12">
                Scan a barcode or tap a product
                <div className="text-xs mt-2 text-slate-700">Scanner input lands here automatically</div>
              </div>
            )}
            {cart.items.map((i) => (
              <div key={i.key} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{i.name}</div>
                    {i.sku && <div className="text-[10px] font-mono text-slate-500">{i.sku}</div>}
                  </div>
                  <button className="text-slate-600 hover:text-red-400 text-xs" onClick={() => cart.removeItem(i.key)}>✕</button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  {i.kind === 'bike' ? (
                    <span className="text-xs text-slate-500">Qty 1 (serialized)</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button className="h-6 w-6 rounded-md bg-slate-800 text-slate-300 text-sm leading-none" onClick={() => cart.setQty(i.key, i.qty - 1)}>−</button>
                      <span className="w-8 text-center text-sm font-semibold">{i.qty}</span>
                      <button
                        className="h-6 w-6 rounded-md bg-slate-800 text-slate-300 text-sm leading-none disabled:opacity-30"
                        disabled={i.qty >= i.stock_qty}
                        onClick={() => cart.setQty(i.key, i.qty + 1)}
                      >+</button>
                    </div>
                  )}
                  <span className="text-sm font-bold text-brand-300">{ugx(i.unit_price * i.qty)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800/70 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Subtotal</span><span>{ugx(totals.subtotal)}</span>
            </div>
            {cart.discount > 0 && (
              <div className="flex justify-between text-sm text-amber-300">
                <span>Discount</span><span>− {ugx(totals.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-white pt-1 border-t border-slate-800/60">
              <span>Total</span><span>{ugx(totals.total)}</span>
            </div>
            <button className="btn-primary w-full" disabled={cart.items.length === 0} onClick={() => setShowCheckout(true)}>
              Checkout · {PAYMENT_LABELS[cart.paymentMethod]}
            </button>
          </div>
        </aside>
      </div>

      {/* Toast */}
      {flash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111814] border border-brand-500/40 text-brand-200 text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {flash}
        </div>
      )}

      {showCheckout && (
        <CheckoutModal
          totals={totals}
          onClose={() => setShowCheckout(false)}
          onComplete={completeCheckout}
        />
      )}

      {receipt && <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />}

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  )
}
