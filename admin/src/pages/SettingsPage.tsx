import { useCallback, useEffect, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { compactUgx, ugx } from '../lib/format'
import { PERIODS } from '../lib/periods'
import type { Period } from '../lib/periods'
import type { RangeReport } from '../lib/types'
import { usePush } from '../hooks/usePush'
import { KpiCard, PageHeader, Spinner } from '../components/ui'
import { PeriodPicker } from '../components/PeriodPicker'
import { Field } from './InventoryPage'

export default function SettingsPage() {
  const push = usePush()
  const [period, setPeriod] = useState<Period>(PERIODS[0])
  const [range, setRange] = useState<RangeReport | null>(null)
  const [cashiers, setCashiers] = useState<{ id: string; full_name: string; sales_count: number; revenue: number; profit: number; discounts: number }[]>([])
  const [pwForm, setPwForm] = useState({ current: '', next: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [testSent, setTestSent] = useState(false)

  const load = useCallback(async () => {
    const win = period.from && period.to
      ? { from: period.from, to: period.to }
      : undefined
    const dayCount = period.days ?? 30
    const [r, c] = await Promise.all([
      api.range(dayCount, win),
      api.cashiers(dayCount, win),
    ])
    setRange(r)
    setCashiers(c.cashiers.map((x) => ({ ...x, revenue: Number(x.revenue), profit: Number(x.profit), discounts: Number(x.discounts) })))
  }, [period])

  useEffect(() => {
    load().catch(() => setRange(null))
  }, [load])

  async function changePw(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg('')
    try {
      await api.changePassword(pwForm.current, pwForm.next)
      setPwMsg('✓ Password updated')
      setPwForm({ current: '', next: '' })
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function sendTest() {
    const ok = await push.sendTest()
    setTestSent(ok)
    setTimeout(() => setTestSent(false), 3000)
  }

  return (
    <div>
      <PageHeader title="Settings & Reports" subtitle="Period reports, staff performance, notifications and security" />

      {/* Range selector */}
      <div className="mb-4">
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      {range ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Revenue" value={ugx(range.kpi.revenue)} delta={`${range.kpi.sales_count} transactions · ${period.label}`} />
            <KpiCard label="Gross profit" value={ugx(range.kpi.profit)} delta={`Avg ${ugx(range.kpi.avg_transaction)}`} />
            <KpiCard label="Bikes sold" value={String(range.kpi.bikes_sold)} delta={`${range.kpi.parts_sold} parts sold`} />
            <KpiCard label="Stock value" value={ugx(range.kpi.stock_value)} delta={`Credit out ${ugx(range.kpi.credit_outstanding)}`} />
          </div>

          <div className="card p-5 mt-4">
            <h3 className="font-semibold text-white mb-4">Daily revenue & profit</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={range.daily.map((d) => ({ ...d, revenue: Number(d.revenue), profit: Number(d.profit), label: new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }))}>
                  <defs>
                    <linearGradient id="rrev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#12b76a" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#12b76a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="rprof" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => compactUgx(v).replace('UGX ', '')} width={55} />
                  <Tooltip contentStyle={{ background: '#12161d', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }} formatter={(value: number) => ugx(value)} />
                  <Area type="monotone" dataKey="revenue" stroke="#12b76a" strokeWidth={2} fill="url(#rrev)" name="Revenue" />
                  <Area type="monotone" dataKey="profit" stroke="#0ea5e9" strokeWidth={2} fill="url(#rprof)" name="Profit" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <Spinner />
      )}

      {/* Cashier leaderboard */}
      <div className="card p-5 mt-4">
        <h3 className="font-semibold text-white mb-4">Staff performance</h3>
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th text-right">Sales</th>
              <th className="th text-right">Revenue</th>
              <th className="th text-right">Profit</th>
              <th className="th text-right">Discounts given</th>
            </tr>
          </thead>
          <tbody>
            {cashiers.map((c) => (
              <tr key={c.id}>
                <td className="td font-medium text-white">{c.full_name}</td>
                <td className="td text-right">{c.sales_count}</td>
                <td className="td text-right">{ugx(c.revenue)}</td>
                <td className="td text-right text-brand-300">{ugx(c.profit)}</td>
                <td className="td text-right text-amber-300">{ugx(c.discounts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Notifications */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-2">🔔 Notifications</h3>
          <p className="text-sm text-slate-500 mb-4">
            Status: <span className="capitalize text-slate-300">{push.state}</span>. You'll get a notification on this device for:
          </p>
          <ul className="text-sm text-slate-400 space-y-1 mb-4">
            <li>• <strong>Sales</strong> — every POS sale completed (receipt no., amount, payment method, cashier)</li>
            <li>• <strong>Low-stock warnings</strong> — a product drops to or below its reorder level</li>
            <li>• <strong>Stock-outs</strong> — a product hits zero stock</li>
            <li>• <strong>Approval requests</strong> — discounts above 5% and credit sales that need a manager's decision</li>
            <li>• <strong>Daily revenue records</strong> — when today's revenue breaks the all-time high</li>
          </ul>
          <div className="flex gap-2">
            {push.state !== 'subscribed' && (
              <button className="btn-primary" onClick={() => push.enable()} disabled={push.busy}>
                {push.busy ? 'Enabling…' : 'Enable on this device'}
              </button>
            )}
            <button className="btn-ghost" onClick={sendTest} disabled={push.state !== 'subscribed'}>
              Send test notification
            </button>
          </div>
          {testSent && <p className="text-xs text-brand-300 mt-2">Test sent — check your notifications.</p>}
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Change password</h3>
          <form onSubmit={changePw} className="space-y-3">
            <Field label="Current password">
              <input className="input" type="password" value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} required />
            </Field>
            <Field label="New password (min 6 chars)">
              <input className="input" type="password" value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} required minLength={6} />
            </Field>
            {pwMsg && <p className="text-sm text-brand-300">{pwMsg}</p>}
            <button className="btn-primary">Update password</button>
          </form>
        </div>
      </div>
    </div>
  )
}
