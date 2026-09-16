import { useCallback, useEffect, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { compactUgx, num, PAYMENT_LABELS, ugx } from '../lib/format'
import type { HourlyPoint, Product, TodayReport } from '../lib/types'
import { Badge, EmptyState, KpiCard, PageHeader, Spinner } from '../components/ui'

const PIE_COLORS = ['#12b76a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444']

export default function OverviewPage() {
  const [today, setToday] = useState<TodayReport | null>(null)
  const [hourly, setHourly] = useState<HourlyPoint[]>([])
  const [top, setTop] = useState<{ name: string; qty: number; revenue: number; profit: number }[]>([])
  const [low, setLow] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

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
    const iv = setInterval(load, 60_000) // live refresh
    return () => clearInterval(iv)
  }, [load])

  if (loading) return <Spinner />
  if (!today) return <EmptyState message="Could not load today's report." />

  const t = today.today
  const donut = today.payments.map((p) => ({ name: PAYMENT_LABELS[p.payment_method] || p.payment_method, value: Number(p.amount) }))
  const partsRev = Number(today.items.find((i) => i.kind === 'part')?.amount || 0)
  const bikesRev = Number(today.items.find((i) => i.kind === 'bike')?.amount || 0)

  return (
    <div>
      <PageHeader
        title="Today's Performance"
        subtitle={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Revenue" value={ugx(t.revenue)} accent delta={`${t.sales_count} transactions`} />
        <KpiCard label="Gross Profit" value={ugx(t.profit)} delta={t.revenue ? `Margin ${((t.profit / t.revenue) * 100).toFixed(1)}%` : undefined} />
        <KpiCard label="Bikes Sold" value={num(t.bikes_sold)} delta={`${ugx(bikesRev)} bikes · ${ugx(partsRev)} parts`} />
        <KpiCard label="Avg Transaction" value={ugx(t.avg_transaction)} delta={`${ugx(t.discounts)} discounts given`} />
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

      {/* Alerts strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <AlertCard label="Low stock alerts" value={t.low_stock_count} tone="amber" />
        <AlertCard label="Pending approvals" value={t.pending_approvals} tone="sky" />
        <AlertCard label="Awaiting sync (POS)" value={t.pending_sync} tone="violet" />
        <AlertCard label="Credit outstanding" value={ugx(t.credit_outstanding)} tone="red" isText />
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
            <EmptyState message="All stock levels healthy 🎉" />
          ) : (
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
          )}
        </div>
      </div>
    </div>
  )
}

function AlertCard({ label, value, tone, isText }: { label: string; value: number | string; tone: 'amber' | 'sky' | 'violet' | 'red'; isText?: boolean }) {
  const tones = {
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    sky: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    violet: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
    red: 'text-red-300 bg-red-500/10 border-red-500/20',
  }
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
      <div className="mt-1 text-xl font-bold">{isText ? value : num(value as number)}</div>
    </div>
  )
}
