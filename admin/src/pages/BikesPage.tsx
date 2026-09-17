import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, num, ugx } from '../lib/format'
import type { Bike, VinLookupResult } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

const EMPTY = { vin: '', model: '', color: '', year: '', motor_number: '', battery_serial: '', battery_spec: '', odometer_km: '0', cost_price: '', selling_price: '', location: 'Main showroom' }

export default function BikesPage() {
  const [bikes, setBikes] = useState<Bike[] | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [lookupVin, setLookupVin] = useState('')
  const [lookupResult, setLookupResult] = useState<VinLookupResult | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api.bikes(q, status)
    setBikes(r.bikes)
  }, [q, status])

  useEffect(() => {
    load().catch(() => setBikes([]))
  }, [load])

  async function saveBike(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.createBike({
        ...form,
        year: form.year ? Number(form.year) : undefined,
        odometer_km: Number(form.odometer_km) || 0,
        cost_price: Number(form.cost_price) || 0,
        selling_price: Number(form.selling_price) || 0,
      })
      setShowForm(false)
      setForm(EMPTY)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function runLookup(e: React.FormEvent) {
    e.preventDefault()
    setLookupBusy(true)
    setLookupError('')
    setLookupResult(null)
    try {
      const r = await api.vinLookup(lookupVin.trim())
      setLookupResult(r)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Bikes & VIN Tracking"
        subtitle="Every bike individually traceable — from purchase to customer"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Add bike</button>}
      />

      {/* VIN 360 lookup */}
      <form onSubmit={runLookup} className="card p-4 mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <svg className="h-5 w-5 text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input className="input flex-1 font-mono" placeholder="Type a VIN / chassis number for full 360 trace…" value={lookupVin} onChange={(e) => setLookupVin(e.target.value)} required />
        <button className="btn-primary w-full sm:w-auto" disabled={lookupBusy}>{lookupBusy ? 'Tracing…' : 'Trace'}</button>
      </form>

      {lookupError && <p className="text-sm text-red-400 mb-4">{lookupError}</p>}

      {lookupResult && (
        <div className="card p-5 mb-4 border-brand-500/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Info label="Model" value={`${lookupResult.bike.model}${lookupResult.bike.color ? ` · ${lookupResult.bike.color}` : ''}`} />
            <Info label="Year" value={String(lookupResult.bike.year ?? '—')} />
            <Info label="Motor" value={lookupResult.bike.motor_number || '—'} />
            <Info label="Battery" value={lookupResult.bike.battery_serial || '—'} />
            <Info label="Status" value={lookupResult.bike.status} />
            <Info label="Cost" value={ugx(lookupResult.bike.cost_price)} />
            <Info label={lookupResult.bike.status === 'sold' ? 'Sold for' : 'Sell price'} value={ugx(lookupResult.bike.sold_price ?? lookupResult.bike.selling_price)} />
            <Info label="Customer" value={lookupResult.bike.customer_name || '—'} />
          </div>
          {lookupResult.sales.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Transaction history</div>
              <div className="space-y-1">
                {lookupResult.sales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm bg-[#0b0e13] rounded-lg px-3 py-2 border border-slate-800/60">
                    <span className="font-mono text-brand-300 text-xs">{s.receipt_no}</span>
                    <span className="text-slate-500 text-xs">{dateTime(s.created_at)} · {s.cashier}</span>
                    <span className="font-semibold text-white">{ugx(s.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-center">
        <input className="input w-full sm:max-w-xs" placeholder="Search VIN, model, motor…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-full sm:max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="in_stock">In stock</option>
          <option value="reserved">Reserved</option>
          <option value="sold">Sold</option>
        </select>
        {bikes && <span className="text-sm text-slate-500 ml-auto">{bikes.length} bikes</span>}
      </div>

      <div className="card overflow-hidden">
        {bikes === null ? (
          <Spinner />
        ) : bikes.length === 0 ? (
          <EmptyState message="No bikes found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">VIN</th>
                  <th className="th">Model</th>
                  <th className="th">Battery</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right">Price</th>
                  <th className="th">Status</th>
                  <th className="th">Customer</th>
                </tr>
              </thead>
              <tbody>
                {bikes.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/30">
                    <td className="td font-mono text-xs text-brand-300">{b.vin}</td>
                    <td className="td">{b.model}{b.color && <span className="text-slate-500 text-xs"> · {b.color}</span>}{b.year ? ` · ${b.year}` : ''}</td>
                    <td className="td text-xs text-slate-500 font-mono">{b.battery_serial || '—'}</td>
                    <td className="td text-right text-slate-400">{ugx(b.cost_price)}</td>
                    <td className="td text-right">{ugx(b.status === 'sold' ? b.sold_price ?? b.selling_price : b.selling_price)}</td>
                    <td className="td"><Badge kind={b.status}>{b.status.replace('_', ' ')}</Badge></td>
                    <td className="td text-slate-400">{b.customer_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add bike modal */}
      {showForm && (
        <Modal title="Add bike to inventory" onClose={() => setShowForm(false)}>
          <form onSubmit={saveBike} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="VIN / Chassis *"><input className="input font-mono" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} required /></Field>
              <Field label="Model *"><input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required placeholder="Spiro Ekon 100" /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Colour"><input className="input" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
              <Field label="Year"><input className="input" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
              <Field label="Odometer (km)"><input className="input" type="number" value={form.odometer_km} onChange={(e) => setForm({ ...form, odometer_km: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Motor number"><input className="input font-mono" value={form.motor_number} onChange={(e) => setForm({ ...form, motor_number: e.target.value })} /></Field>
              <Field label="Battery serial"><input className="input font-mono" value={form.battery_serial} onChange={(e) => setForm({ ...form, battery_serial: e.target.value })} /></Field>
            </div>
            <Field label="Battery spec"><input className="input" value={form.battery_spec} onChange={(e) => setForm({ ...form, battery_spec: e.target.value })} placeholder="60V 32Ah LFP" /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Cost (UGX)"><input className="input" type="number" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} /></Field>
              <Field label="Sell price (UGX)"><input className="input" type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} /></Field>
              <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary w-full sm:w-auto">Add bike</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-medium text-white mt-0.5 break-words text-sm">{value}</div>
    </div>
  )
}
