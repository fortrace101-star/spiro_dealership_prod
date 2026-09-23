import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { compactUgx, dateTime, num, ugx } from '../lib/format'
import type { Bike, BikeReservation, VinLookupResult } from '../lib/types'
import { Badge, badgeTint, EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'
import { useIsPhone } from '../lib/usePageSize'
import { ReservationDetailModal, ReserveBikeModal, ReservationsTabContent } from './ReservationModals'


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
  // Compact filter text on phones, full text from `sm:` up (same as the Sales period picker).
  const phone = useIsPhone()

  // installments / reservations
  const [tab, setTab] = useState<'inventory' | 'reservations'>('inventory')
  const [reservations, setReservations] = useState<BikeReservation[] | null>(null)
  const [resFilter, setResFilter] = useState('active')
  const [resQ, setResQ] = useState('')
  const [showReserve, setShowReserve] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailBike, setDetailBike] = useState<Bike | null>(null)
  const [resError, setResError] = useState('')

    const load = useCallback(async () => {
    const r = await api.bikes(q, status)
    setBikes(r.bikes)
  }, [q, status])

  // Re-read bikes whenever the filter changes and each time the Inventory tab is
  // re-opened: a bike can be sold by a reservation payment (or from the POS) while
  // this page is open, and a stale row would still read "In stock".
  useEffect(() => {
    if (tab === 'inventory') load().catch(() => setBikes([]))
  }, [load, tab])

  const loadRes = useCallback(async () => {
    try {
      const r = await api.reservations(resFilter, resQ)
      setReservations(r.reservations)
      setResError('')
    } catch (err) {
      setReservations([])
      setResError(err instanceof Error ? err.message : 'Could not load reservations')
    }
  }, [resFilter, resQ])

  useEffect(() => {
    loadRes()
  }, [loadRes])

  // One refresh for both lists: paying a reservation off flips its bike to `sold`,
  // so the Inventory tab must reload alongside the reservations list.
  const refresh = useCallback(() => {
    load().catch(() => setBikes([]))
    loadRes()
  }, [load, loadRes])

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

  async function trace(vin: string) {
    setLookupBusy(true)
    setLookupError('')
    setLookupResult(null)
    try {
      const r = await api.vinLookup(vin.trim())
      setLookupResult(r)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  function runLookup(e: React.FormEvent) {
    e.preventDefault()
    void trace(lookupVin)
  }

  return (
    <div>
      <PageHeader
        title="Bikes & VIN Tracking"
        subtitle="Every bike individually traceable — from purchase to customer"
                actions={tab === 'inventory'
          ? <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add bike</button>
          : <button className="btn-primary" onClick={() => setShowReserve(true)}>+ Reserve bike</button>}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 card p-1">
        <button className={cn('btn text-xs', tab === 'inventory' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('inventory')}>Inventory</button>
        <button className={cn('btn text-xs', tab === 'reservations' ? 'btn-primary' : 'btn-ghost')} onClick={() => setTab('reservations')}>Installments / Reservations</button>
      </div>

      {tab === 'inventory' && (
      <>

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
            <div className={cn('border rounded-xl p-3', badgeTint(lookupResult.bike.status).card)}>
              <div className="text-xs text-slate-500 mb-1">Status</div>
              <div className={cn('text-sm font-semibold capitalize', badgeTint(lookupResult.bike.status).text)}>{lookupResult.bike.status.replace('_', ' ')}</div>
            </div>
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

      {/* Filters — same responsive structure as the Sales filter card:
          Row 1 titled picker, Row 2 search (fills space) + Search button, count below */}
      <div className="card p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[150px]">
            <Field label="Status">
              <select className="input w-full truncate text-[13px] sm:text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{phone ? 'All' : 'All statuses'}</option>
                <option value="in_stock">In stock</option>
                <option value="reserved">Reserved</option>
                <option value="sold">Sold</option>
              </select>
            </Field>
          </div>
        </div>

        <form
          className="flex flex-wrap gap-3 items-start"
          onSubmit={(e) => {
            e.preventDefault()
            load().catch(() => setBikes([]))
          }}
        >
          <div className="flex-1 min-w-0">
            <input
              className="input w-full text-[13px] sm:text-sm"
              aria-label="Search bikes"
              placeholder={phone ? 'Search…' : 'Search VIN, model, motor…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {bikes && <div className="mt-3 text-xs text-slate-500">{bikes.length} bikes</div>}
          </div>
          <button type="submit" className="btn-primary text-xs px-5">Search</button>
        </form>
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
                  {/* Phones: stacked Model/VIN primary cell + merged Cost/Price; sm+: the separate columns */}
                  <th className="th sm:hidden">
                    <div className="text-slate-200">Model</div>
                    <div className="border-t border-slate-800/80 my-1" />
                    <div className="text-brand-300">VIN</div>
                  </th>
                  <th className="th col-opt">VIN</th>
                  <th className="th col-opt">Model</th>
                  <th className="th col-opt">Battery</th>
                  <th className="th text-right sm:hidden">
                    <div className="text-slate-400">Cost</div>
                    <div className="border-t border-slate-800/80 my-1" />
                    <div className="text-slate-200">Price</div>
                  </th>
                  <th className="th col-opt text-right">Cost</th>
                  <th className="th col-opt text-right">Price</th>
                  <th className="th">Status</th>
                  <th className="th">Customer</th>
                </tr>
              </thead>
              <tbody>
                {bikes.map((b) => {
                  const price = b.status === 'sold' ? b.sold_price ?? b.selling_price : b.selling_price
                  return (
                    <tr key={b.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => setDetailBike(b)}>
                      {/* Phones: Model over the bare VIN subline; sm+: separate VIN / Model columns */}
                      <td className="td sm:hidden">
                        <div className="font-medium text-white">{b.model}{b.color && <span className="text-slate-500 text-xs"> · {b.color}</span>}{b.year ? ` · ${b.year}` : ''}</div>
                        <div className="text-[11px] font-mono text-brand-300">{b.vin}</div>
                      </td>
                      <td className="td col-opt font-mono text-xs text-brand-300">{b.vin}</td>
                      <td className="td col-opt sm:text-[13px]">{b.model}{b.color && <span className="text-slate-500 text-xs"> · {b.color}</span>}{b.year ? ` · ${b.year}` : ''}</td>
                      <td className="td col-opt text-xs text-slate-500 font-mono">{b.battery_serial || '—'}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap sm:hidden">
                        <div className="text-slate-400">{compactUgx(b.cost_price)}</div>
                        <div className="border-t border-slate-800/80 my-1" />
                        <div>{compactUgx(price)}</div>
                      </td>
                      <td className="td col-opt text-right text-slate-400 tabular-nums whitespace-nowrap sm:text-[13px]">{ugx(b.cost_price)}</td>
                      <td className="td col-opt text-right tabular-nums whitespace-nowrap sm:text-[13px]">{ugx(price)}</td>
                      <td className="td sm:text-[13px]"><Badge kind={b.status}>{b.status.replace('_', ' ')}</Badge></td>
                      <td className="td text-slate-400 sm:text-[13px]">
                        {b.customer_name || '—'}
                        <span className="sm:hidden text-slate-600 text-xs ml-2">›</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
            </div>
      </>
      )}

      {tab === 'reservations' && (
        <ReservationsTabContent
          reservations={reservations}
          resFilter={resFilter}
          setResFilter={setResFilter}
          resQ={resQ}
          setResQ={setResQ}
          onReserve={() => setShowReserve(true)}
          onOpenDetail={(id: string) => setDetailId(id)}
        />
      )}

      {/* Bike detail drawer (Rule 2: home for the mobile-hidden columns) */}
      {detailBike && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailBike(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="font-medium text-white text-lg">{detailBike.model}{detailBike.color ? ` · ${detailBike.color}` : ''}{detailBike.year ? ` · ${detailBike.year}` : ''}</div>
                <div className="text-xs font-mono text-brand-300 break-all">VIN : {detailBike.vin}</div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setDetailBike(null)}>Close</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Sell price</div>
                <div className="text-base font-semibold text-white">{ugx(detailBike.status === 'sold' ? detailBike.sold_price ?? detailBike.selling_price : detailBike.selling_price)}</div>
              </div>
              {/* Status card mirrors the table Badge: status-colored tinted background + value text */}
              <div className={cn('border rounded-xl p-3', badgeTint(detailBike.status).card)}>
                <div className="text-xs text-slate-500 mb-1">Status</div>
                <div className={cn('text-base font-semibold capitalize', badgeTint(detailBike.status).text)}>{detailBike.status.replace('_', ' ')}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-6">
              <Info label="VIN" value={detailBike.vin} />
              <Info label="Battery serial" value={detailBike.battery_serial || '—'} />
              <Info label="Battery spec" value={detailBike.battery_spec || '—'} />
              <Info label="Motor number" value={detailBike.motor_number || '—'} />
              <Info label="Cost price" value={ugx(detailBike.cost_price)} />
              <Info label="Odometer" value={`${num(detailBike.odometer_km)} km`} />
              <Info label="Location" value={detailBike.location || '—'} />
              <Info label="Customer" value={detailBike.customer_name || '—'} />
              <Info label="Received" value={dateTime(detailBike.received_at)} />
              {detailBike.status === 'sold' && <Info label="Sold on" value={detailBike.sold_at ? dateTime(detailBike.sold_at) : '—'} />}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost w-full sm:w-auto" onClick={() => { const v = detailBike.vin; setDetailBike(null); setLookupVin(v); void trace(v) }}>360 trace</button>
              <button
                className="btn-primary w-full sm:w-auto"
                disabled={detailBike.status !== 'in_stock'}
                onClick={() => { setDetailBike(null); setShowReserve(true) }}
              >
                Reserve
              </button>
            </div>
          </div>
        </div>
      )}

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

      {showReserve && <ReserveBikeModal onClose={() => setShowReserve(false)} onDone={() => { setShowReserve(false); refresh() }} />}
      {detailId && <ReservationDetailModal id={detailId} onClose={() => setDetailId(null)} onUpdated={refresh} />}
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
