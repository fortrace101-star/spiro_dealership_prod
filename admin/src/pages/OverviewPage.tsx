import { useCallback, useEffect, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { compactUgx, dateTime, num, PAYMENT_LABELS, timeAgo, ugx } from '../lib/format'
import type { Approval, HourlyPoint, Product, Sale, TodayReport } from '../lib/types'
import { cn } from '../lib/cn'
import { Badge, EmptyState, KpiCard, PageHeader, Spinner } from '../components/ui'
import { Modal } from '../components/Modal'

const PIE_COLORS = ['#12b76a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444']

type CardDetail =
  | { kind: 'loading' }
  | { kind: 'sales'; title: string; subtitle: string; sales: Sale[]; showStatus?: boolean }
  | { kind: 'lowstock'; products: Product[] }
  | { kind: 'approvals'; approvals: Approval[] }

export default function OverviewPage() {
  const navigate = useNavigate()
  const [today, setToday] = useState<TodayReport | null>(null)
  const [hourly, setHourly] = useState<HourlyPoint[]>([])
  const [top, setTop] = useState<{ name: string; qty: number; revenue: number; profit: number }[]>([])
  const [low, setLow] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<CardDetail | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, h, tp, ls] = await Promise.all([
        api.today(),
        api.hourly(),
        api.topProducts(30, 'revenue'),
        api.lowStock(),
      ])
      setToday(t)
      setHourly(h.series)
      setTop(tp.products.slice(0, 7).map((p) => ({ ...p, revenue: Number(p.revenue), profit: Number(p.profit) })))
      setLow(ls.products.slice(0, 6))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5_000) // live refresh
    return () => clearInterval(iv)
  }, [load])

  // ---- Card drill-down loaders ----
  async function openSales(opts: { days?: number; payment?: string; title: string; subtitle: string; filter?: (s: Sale) => boolean; showStatus?: boolean }) {
    setDetail({ kind: 'loading' })
    const params = new URLSearchParams()
    if (opts.days !== undefined) params.set('days', String(opts.days))
    if (opts.payment) params.set('payment', opts.payment)
    try {
      const r = await api.sales(params.toString())
      const sales = opts.filter ? r.sales.filter(opts.filter) : r.sales
      setDetail({ kind: 'sales', title: opts.title, subtitle: opts.subtitle, sales, showStatus: opts.showStatus })
    } catch {
      setDetail(null)
    }
  }

  const openRevenue = () =>
    openSales({ days: 1, title: 'Revenue details', subtitle: 'All transactions recorded today' })
  const openProfit = () =>
    openSales({ days: 1, title: 'Gross profit details', subtitle: 'Profit per transaction (selling price − cost)' })
  const openBikes = () =>
    openSales({ days: 1, title: 'Bikes sold today', subtitle: 'Transactions that included a bike (matched by VIN)' })
  const openAvg = () =>
    openSales({ days: 1, title: 'Transaction size breakdown', subtitle: 'Every sale today, largest first' })

  async function openLowStock() {
    setDetail({ kind: 'loading' })
    try {
      const r = await api.lowStock()
      setDetail({ kind: 'lowstock', products: r.products })
    } catch {
      setDetail(null)
    }
  }

  async function openApprovals() {
    setDetail({ kind: 'loading' })
    try {
      const r = await api.approvals('pending')
      setDetail({ kind: 'approvals', approvals: r.approvals })
    } catch {
      setDetail(null)
    }
  }

  const openSync = () =>
    openSales({
      days: 2,
      title: 'Awaiting sync (POS)',
      subtitle: 'Offline POS sales not yet confirmed by the server',
      filter: (s) => s.status !== 'completed',
      showStatus: true,
    })

  // Credit outstanding lives on the Credit ledger page now — drill straight there.
  const openCredit = () => navigate('/credit')
  const openCreditPending = () => navigate('/credit?view=pending')

  if (loading) return <Spinner />
  if (!today) return <EmptyState message="Could not load today's report." />

  const t = today.today
  const donut = today.payments.map((p) => ({ name: PAYMENT_LABELS[p.payment_method] || p.payment_method, value: Number(p.amount) }))
  const partsRev = Number(today.items.find((i) => i.kind === 'part')?.amount || 0)
  const bikesRev = Number(today.items.find((i) => i.kind === 'bike')?.amount || 0)
  const margin = t.revenue ? ((t.profit / t.revenue) * 100).toFixed(1) : '0.0'

  return (
    <div>
      <PageHeader
        title="Today's Performance"
        subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {/* KPI row — 2×2 at every breakpoint */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard
          label="Revenue"
          value={ugx(t.revenue)}
          accent
          delta={`${t.sales_count} transactions`}
          onClick={openRevenue}
        />
        <KpiCard label="Gross Profit" value={ugx(t.profit)} delta={`Margin ${margin}%`} onClick={openProfit} />
        <KpiCard
          label="Bikes Sold"
          value={num(t.bikes_sold)}
          delta={`${ugx(bikesRev)} bikes · ${ugx(partsRev)} parts`}
          onClick={openBikes}
        />
        <KpiCard
          label="Avg Transaction"
          value={ugx(t.avg_transaction)}
          delta={`${ugx(t.discounts)} discounts given`}
          onClick={openAvg}
        />
      </div>

      {/* Chart + donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Revenue today (hourly)</h3>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-400" /> Revenue</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> Profit</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourly.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#12b76a" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#12b76a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => compactUgx(v).replace('UGX ', '')} width={55} />
                <Tooltip
                  contentStyle={{ background: '#12161d', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }}
                  formatter={(value: number, name: string) => [ugx(value), name]}
                />
                <Area type="monotone" dataKey="revenue" stroke="#12b76a" strokeWidth={2} fill="url(#rev)" name="Revenue" />
                <Area type="monotone" dataKey="profit" stroke="#0ea5e9" strokeWidth={2} fill="url(#prof)" name="Profit" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Payment mix today</h3>
          {donut.length === 0 ? (
            <EmptyState message="No payments yet today" />
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={3} strokeWidth={0}>
                      {donut.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#12161d', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }}
                      formatter={(value: number) => ugx(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {donut.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {d.name}
                    </span>
                    <span className="font-semibold text-white">{compactUgx(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Alerts strip — 2×2 at every breakpoint */}
      <div className="grid grid-cols-2 gap-4 mt-4">
        <AlertCard label="Low stock alerts" value={t.low_stock_count} tone="amber" onClick={openLowStock} />
        <AlertCard label="Pending approvals" value={t.pending_approvals} tone="sky" onClick={openApprovals} />
        <AlertCard label="Awaiting sync (POS)" value={t.pending_sync} tone="violet" onClick={openSync} />
        <AlertCard label="Credit outstanding" value={ugx(t.credit_outstanding)} tone="red" isText onClick={openCredit} />
        <AlertCard label="Awaiting credit approval" value={t.credit_pending} tone="amber" onClick={openCreditPending} />
      </div>

      {/* Top products + low stock */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Top products · last 30 days</h3>
          {top.length === 0 ? (
            <EmptyState message="No sales in the last 30 days" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => compactUgx(v).replace('UGX ', '')} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} width={140} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#12161d', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }}
                    formatter={(value: number) => ugx(value)}
                    cursor={{ fill: '#1e293b55' }}
                  />
                  <Bar dataKey="revenue" fill="#12b76a" radius={[0, 6, 6, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Reorder alerts</h3>
          {low.length === 0 ? (
            <EmptyState message="All stock levels healthy" />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Stock</th>
                  <th className="th">Reorder at</th>
                </tr>
              </thead>
              <tbody>
                {low.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <div className="font-medium text-white">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.sku}</div>
                    </td>
                    <td className="td"><Badge kind={p.stock_qty === 0 ? 'credit' : 'pending'}>{p.stock_qty} left</Badge></td>
                    <td className="td text-slate-400">{p.reorder_level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {/* ---- Card detail modals ---- */}
      {detail?.kind === 'loading' && (
        <Modal title="Loading details…" onClose={() => setDetail(null)}>
          <Spinner />
        </Modal>
      )}

      {detail?.kind === 'sales' && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          <p className="text-xs text-slate-500 -mt-2 mb-3">{detail.subtitle} · {detail.sales.length} found</p>
          <SalesTable sales={detail.sales} showStatus={detail.showStatus} />
        </Modal>
      )}

      {detail?.kind === 'lowstock' && (
        <Modal title="Low stock products" onClose={() => setDetail(null)} wide>
          {detail.products.length === 0 ? (
            <EmptyState message="All stock levels healthy 🎉" />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Product</th>
                  <th className="th text-right">In stock</th>
                  <th className="th text-right">Min</th>
                  <th className="th text-right">Reorder at</th>
                  <th className="th text-right">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {detail.products.map((p) => (
                  <tr key={p.id}>
                    <td className="td">
                      <div className="font-medium text-white">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.sku} · {p.category}</div>
                    </td>
                    <td className="td text-right">
                      <Badge kind={p.stock_qty === 0 ? 'credit' : 'pending'}>{p.stock_qty} left</Badge>
                    </td>
                    <td className="td text-right text-slate-400">{p.min_stock}</td>
                    <td className="td text-right text-slate-400">{p.reorder_level}</td>
                    <td className="td text-right">{ugx(p.stock_value ?? Number(p.cost_price) * p.stock_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Modal>
      )}

      {detail?.kind === 'approvals' && (
        <Modal title="Pending approvals" onClose={() => setDetail(null)} wide>
          {detail.approvals.length === 0 ? (
            <EmptyState message="Nothing waiting for approval 🎉" />
          ) : (
            <div className="space-y-3">
              {detail.approvals.map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-800/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge kind={a.type}>{a.type.replace('_', ' ')}</Badge>
                      <span className="text-sm text-slate-300">{a.requested_by_name || 'Unknown'}</span>
                    </div>
                    <span className="text-xs text-slate-500">{timeAgo(a.created_at)}</span>
                  </div>
                  {approvalAmount(a.payload) && (
                    <div className="mt-2 text-sm font-semibold text-white">{approvalAmount(a.payload)}</div>
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-500">Review and decide these in the Approvals page.</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

function SalesTable({ sales, showStatus }: { sales: Sale[]; showStatus?: boolean }) {
  if (sales.length === 0) return <EmptyState message="Nothing to show for this period." />
  return (
    <>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Receipt</th>
                <th className="th">When</th>
                <th className="th">Customer</th>
                {showStatus ? <th className="th">Status</th> : <th className="th">Method</th>}
                <th className="th text-right">Total</th>
              </tr>
            </thead>
        <tbody>
          {sales.slice(0, 50).map((s) => (
            <tr key={s.id}>
              <td className="td font-medium text-white">{s.receipt_no}</td>
              <td className="td text-slate-400">{dateTime(s.created_at)}</td>
              <td className="td">{s.customer_name || '—'}</td>
              {showStatus ? (
                <td className="td"><Badge kind={s.status}>{s.status}</Badge></td>
              ) : (
                <td className="td"><Badge kind={s.payment_method}>{PAYMENT_LABELS[s.payment_method] || s.payment_method}</Badge></td>
              )}
              <td className="td text-right font-semibold">{ugx(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {sales.length > 50 && <p className="text-xs text-slate-500 mt-2">Showing first 50 of {sales.length}</p>}
    </>
  )
}

function approvalAmount(payload: Record<string, unknown>): string | null {
  const cand = payload.amount ?? payload.total ?? payload.value ?? payload.discount
  if (cand === undefined || cand === null) return null
  const n = Number(cand)
  return Number.isNaN(n) ? null : ugx(n)
}

function AlertCard({
  label,
  value,
  tone,
  isText,
  onClick,
}: {
  label: string
  value: number | string
  tone: 'amber' | 'sky' | 'violet' | 'red'
  isText?: boolean
  onClick?: () => void
}) {
  const tones = {
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    sky: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    violet: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
    red: 'text-red-300 bg-red-500/10 border-red-500/20',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={onClick ? `${label} — view details` : undefined}
      className={cn(
        'rounded-2xl border p-3 sm:p-4 text-left transition',
        tones[tone],
        onClick && 'cursor-pointer hover:brightness-125 focus:outline-none focus:ring-1 focus:ring-white/30',
      )}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold opacity-80 flex items-center justify-between gap-2">
        {label}
        {onClick && <span aria-hidden>→</span>}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{isText ? value : num(value as number)}</div>
    </button>
  )
}
