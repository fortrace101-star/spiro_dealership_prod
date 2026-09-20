import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, PAYMENT_LABELS, ugx } from '../lib/format'
import type { Customer, Sale, SaleItem } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

interface CustomerDetail {
  customer: Customer
  bikes: { id: string; bike_id: string | null; external_desc: string | null; plate: string | null; vin: string | null; model: string | null; status: string | null }[]
  purchases: Sale[]
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  // Purchase-order drill-down inside the customer detail modal
  const [saleDetail, setSaleDetail] = useState<{ sale: Sale; items: SaleItem[] } | null>(null)
  const [saleLoading, setSaleLoading] = useState(false)
  const [saleError, setSaleError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', address: '', notes: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await api.customers(q)
    setCustomers(r.customers)
  }, [q])

  useEffect(() => {
    load().catch(() => setCustomers([]))
  }, [load])

  async function open(id: string) {
    setDetail(await api.customer(id))
  }

  /** Drill into one purchase order from the customer's history. */
  async function openPurchase(id: string) {
    setSaleError('')
    setSaleLoading(true)
    try {
      setSaleDetail(await api.sale(id))
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Could not load the purchase order')
    } finally {
      setSaleLoading(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.createCustomer(form)
      setShowForm(false)
      setForm({ full_name: '', phone: '', email: '', address: '', notes: '' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Customer 360 — profiles, bikes, purchase history"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Add customer</button>}
      />

      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input className="input w-full sm:max-w-xs" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        {customers && <span className="text-sm text-slate-500 ml-auto">{customers.length} customers</span>}
      </div>

      <div className="card overflow-hidden">
        {customers === null ? (
          <Spinner />
        ) : customers.length === 0 ? (
          <EmptyState message="No customers yet. They are created automatically at checkout, or add one here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Customer</th>
                  <th className="th">Phone</th>
                  <th className="th">Location</th>
                  <th className="th text-right">Purchases</th>
                  <th className="th text-right">Lifetime value</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => open(c.id)}>
                    <td className="td font-medium text-white">{c.full_name}</td>
                    <td className="td text-slate-400 font-mono text-xs">{c.phone || '—'}</td>
                    <td className="td text-slate-400">{c.address || '—'}</td>
                    <td className="td text-right">{c.purchase_count ?? 0}</td>
                    <td className="td text-right font-semibold text-white">{ugx(c.lifetime_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 360 drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-lg font-bold text-white">{detail.customer.full_name}</div>
                <div className="text-xs text-slate-500">{detail.customer.phone || 'no phone'} · {detail.customer.address || 'no address'}</div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Lifetime value</div>
                <div className="text-xl font-bold text-brand-300 mt-0.5">{ugx(detail.purchases.reduce((s, p) => s + Number(p.total), 0))}</div>
              </div>
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Transactions</div>
                <div className="text-xl font-bold text-white mt-0.5">{detail.purchases.length}</div>
              </div>
            </div>

            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Bikes</h4>
            {detail.bikes.length === 0 ? (
              <p className="text-sm text-slate-600 mb-4">No bikes linked.</p>
            ) : (
              <div className="space-y-1.5 mb-6">
                {detail.bikes.map((b) => (
                  <div key={b.id} className="flex items-center justify-between bg-[#0b0e13] rounded-xl px-3 py-2 border border-slate-800/60 text-sm">
                    <span className="text-white">{b.model || b.external_desc || 'Bike'} {b.vin && <span className="font-mono text-xs text-slate-500">· {b.vin}</span>}</span>
                    {b.status && <Badge kind={b.status}>{b.status.replace('_', ' ')}</Badge>}
                  </div>
                ))}
              </div>
            )}

            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Purchase history</h4>
            {detail.purchases.length === 0 ? (
              <p className="text-sm text-slate-600">No purchases yet.</p>
            ) : (
              <div className="space-y-1.5">
                {detail.purchases.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-[#0b0e13] rounded-xl px-3 py-2 border border-slate-800/60 text-sm hover:border-brand-500/40 cursor-pointer transition"
                    onClick={() => void openPurchase(p.id)}
                  >
                    <div>
                      <span className="font-mono text-xs text-brand-300">{p.receipt_no}</span>
                      <div className="text-[11px] text-slate-600">{dateTime(p.created_at)} · {PAYMENT_LABELS[p.payment_method] || p.payment_method}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{ugx(p.total)}</span>
                      <span className="text-slate-600 text-xs">›</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Purchase order detail — layered above the customer modal */}
      {saleDetail && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" onClick={() => setSaleDetail(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full card rounded-b-none sm:rounded-2xl p-4 sm:p-5 max-h-[92vh] overflow-y-auto sm:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4 gap-4">
              <div>
                <div className="font-mono text-brand-300 text-lg">{saleDetail.sale.receipt_no}</div>
                <div className="text-xs text-slate-500">{dateTime(saleDetail.sale.created_at)}</div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setSaleDetail(null)}>Close</button>
            </div>

            {/* Transaction metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-4">
              <Info label="Customer" value={saleDetail.sale.customer_name || 'Walk-in'} />
              <Info label="Cashier" value={saleDetail.sale.cashier_name || '—'} />
              <Info label="Payment method" value={PAYMENT_LABELS[saleDetail.sale.payment_method] || saleDetail.sale.payment_method} />
              <Info label="Status" value={saleDetail.sale.status} />
              <Info label="Device" value={saleDetail.sale.device_id || '—'} />
              <Info label="Transaction ID" value={saleDetail.sale.client_txn_id || '—'} />
              {saleDetail.sale.bike_vin && <Info label="Bike VIN" value={saleDetail.sale.bike_vin} />}
              {saleDetail.sale.bike_model && <Info label="Bike model" value={saleDetail.sale.bike_model} />}
            </div>

            {/* What they bought */}
            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Items</h4>
            <table className="w-full mb-4">
              <thead>
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {saleDetail.items.map((it) => (
                  <tr key={it.id}>
                    <td className="td">{it.name}{it.kind === 'bike' && <span className="text-xs text-brand-300 ml-1">🛵</span>}</td>
                    <td className="td text-right">{it.qty}</td>
                    <td className="td text-right text-slate-400">{ugx(it.unit_price)}</td>
                    <td className="td text-right">{ugx(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Amounts */}
            <div className="space-y-1.5 text-sm border-t border-slate-800 pt-3">
              <Row label="Subtotal" value={ugx(saleDetail.sale.subtotal)} />
              {Number(saleDetail.sale.discount) > 0 && <Row label="Discount" value={`− ${ugx(saleDetail.sale.discount)}`} />}
              <Row label="Total" value={ugx(saleDetail.sale.total)} bold />
              <Row label="Gross profit" value={ugx(saleDetail.sale.profit)} />
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showForm && (
        <Modal title="Add customer" onClose={() => setShowForm(false)}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Full name *"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+25677…" /></Field>
              <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <Field label="Address"><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary w-full sm:w-auto">Add customer</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

/** Metadata tile for the purchase-order detail modal. */
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-medium text-white mt-0.5 break-words">{value}</div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'text-white font-semibold text-base' : 'text-slate-400'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
