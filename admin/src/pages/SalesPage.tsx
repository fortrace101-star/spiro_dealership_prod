import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, num, PAYMENT_LABELS, ugx } from '../lib/format'
import { PERIODS } from '../lib/periods'
import type { Period } from '../lib/periods'
import type { Sale, SaleItem } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { PeriodPicker } from '../components/PeriodPicker'

const PAGE_SIZE = 20

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState<Period>(PERIODS[0]) // Today by default
  const [payment, setPayment] = useState('')
  const [detail, setDetail] = useState<{ sale: Sale; items: SaleItem[] } | null>(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (period.from && period.to) {
      // pad `to` to the end of that day so the whole “to” date is included
      const to = new Date(`${period.to}T23:59:59`)
      params.set('from', new Date(`${period.from}T00:00:00`).toISOString())
      params.set('to', to.toISOString())
    } else if (period.days) {
      params.set('days', String(period.days))
    }
    if (payment) params.set('payment', payment)
    const r = await api.sales(params.toString())
    setSales(r.sales)
  }, [q, period, payment])

  useEffect(() => {
    setPage(1)
    load().catch(() => setSales([]))
  }, [load])

  async function openDetail(id: string) {
    const r = await api.sale(id)
    setDetail(r)
  }

  const totalPages = Math.max(1, Math.ceil((sales?.length || 0) / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = (sales || []).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const rangeFrom = (sales?.length || 0) === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(safePage * PAGE_SIZE, sales?.length || 0)

  return (
    <div>
      <PageHeader title="Sales" subtitle="Every transaction across the dealership" />

      <div className="card p-4 mb-4 space-y-3">
        <PeriodPicker period={period} onChange={setPeriod} />
        <div className="flex flex-wrap gap-3 items-center">
          <input className="input w-full sm:max-w-xs" placeholder="Search receipt, cashier, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-full sm:max-w-[180px]" value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="">All payments</option>
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {sales && <span className="text-sm text-slate-500 ml-auto">{sales.length} transactions</span>}
        </div>
      </div>

      <div className="card overflow-hidden">
        {sales === null ? (
          <Spinner />
        ) : sales.length === 0 ? (
          <EmptyState message="No sales match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Receipt</th>
                  <th className="th">Date</th>
                  <th className="th">Cashier</th>
                  <th className="th">Customer</th>
                  <th className="th">Payment</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => openDetail(s.id)}>
                    <td className="td font-mono text-xs text-brand-300">{s.receipt_no}</td>
                    <td className="td text-slate-400">{dateTime(s.created_at)}</td>
                    <td className="td">{s.cashier_name || '—'}</td>
                    <td className="td text-slate-400">{s.customer_name || 'Walk-in'}</td>
                    <td className="td"><Badge kind={s.payment_method}>{PAYMENT_LABELS[s.payment_method] || s.payment_method}</Badge></td>
                    <td className="td text-right font-semibold text-white">{ugx(s.total)}</td>
                    <td className="td text-right text-brand-300">{ugx(s.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {sales && sales.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-slate-500">Showing {rangeFrom}–{rangeTo} of {sales.length}</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <span className="text-slate-400 text-xs">Page {safePage} of {totalPages}</span>
            <button className="btn-ghost text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="font-mono text-brand-300 text-lg">{detail.sale.receipt_no}</div>
                <div className="text-xs text-slate-500">{dateTime(detail.sale.created_at)}</div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-6">
              <Info label="Cashier" value={detail.sale.cashier_name || '—'} />
              <Info label="Customer" value={detail.sale.customer_name || 'Walk-in'} />
              <Info label="Payment" value={PAYMENT_LABELS[detail.sale.payment_method] || detail.sale.payment_method} />
              <Info label="Device" value={detail.sale.device_id || '—'} />
              {detail.sale.bike_vin && <Info label="Bike VIN" value={detail.sale.bike_vin} />}
              <Info label="Status" value={detail.sale.status} />
            </div>

            <table className="w-full mb-6">
              <thead>
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td className="td">{it.name}{it.kind === 'bike' && <span className="text-xs text-brand-300 ml-1">🛵</span>}</td>
                    <td className="td text-right">{it.qty}</td>
                    <td className="td text-right text-slate-400">{ugx(it.unit_price)}</td>
                    <td className="td text-right">{ugx(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1.5 text-sm border-t border-slate-800 pt-4">
              <Row label="Subtotal" value={ugx(detail.sale.subtotal)} />
              <Row label="Discount" value={`− ${ugx(detail.sale.discount)}`} />
              <Row label="Total" value={ugx(detail.sale.total)} bold />
              <Row label="Gross profit" value={ugx(detail.sale.profit)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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
