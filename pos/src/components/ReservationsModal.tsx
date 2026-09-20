import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { api, getStoredUser } from '../lib/api'
import { dateTime, PAYMENT_LABELS, ugx } from '../lib/format'
import type { Bike, BikeReservation } from '../lib/types'
import { cn } from '../lib/cn'

const PLAN_OPTIONS = [3, 6, 9, 12, 18, 24]
const METHODS = ['cash', 'mobile_money', 'bank', 'card', 'credit']

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  released: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  expired: 'bg-red-500/15 text-red-300 border-red-500/30',
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/70 shrink-0">
          <h3 className="font-bold text-white text-lg">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', STATUS_STYLES[status] || STATUS_STYLES.released)}>
      {status}
    </span>
  )
}

/**
 * Reservations screen for the POS: take down payments on E-bikes, track each
 * installment, and complete the sale once the bike is paid off completely.
 * Requires connectivity — reservations lock the VIN server-side so they can
 * never queue offline like sales do.
 */
export default function ReservationsModal({
  prefillBike,
  onClose,
  onFlash,
}: {
  prefillBike?: Bike | null
  onClose: () => void
  onFlash?: (msg: string) => void
}) {
  const user = getStoredUser()!
  const canRelease = user.role !== 'operator' || (user.permissions || []).includes('inventory_entry')
  const [view, setView] = useState<'list' | 'reserve' | 'detail'>(prefillBike ? 'reserve' : 'list')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reservations, setReservations] = useState<BikeReservation[] | null>(null)
  const [filter, setFilter] = useState('active')
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api.reservationsLookup(filter, q)
      setReservations(r.reservations)
      setError('')
    } catch (err) {
      setReservations([])
      setError(err instanceof Error ? err.message : 'Could not load reservations — check your connection')
    }
  }, [filter, q])

  useEffect(() => {
    if (view === 'list') load()
  }, [view, load])

  const title = view === 'reserve' ? 'Reserve bike — installment plan' : view === 'detail' ? 'Reservation details' : 'Bike reservations & installments'

  return (
    <Shell title={title} onClose={onClose}>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {view === 'list' && (
        <ListPane
          reservations={reservations}
          filter={filter}
          setFilter={setFilter}
          q={q}
          setQ={setQ}
          onNew={() => setView('reserve')}
          onOpen={(id) => { setDetailId(id); setView('detail') }}
        />
      )}

      {view === 'reserve' && (
        <ReserveForm
          prefillBike={prefillBike}
          onDone={(msg) => {
            setView('list')
            setFilter('active')
            onFlash?.(msg)
          }}
          onCancel={() => setView('list')}
        />
      )}

      {view === 'detail' && detailId && (
        <DetailPane
          id={detailId}
          canRelease={canRelease}
          onChanged={load}
          onBack={() => setView('list')}
        />
      )}
    </Shell>
  )
}

function ListPane({
  reservations, filter, setFilter, q, setQ, onNew, onOpen,
}: {
  reservations: BikeReservation[] | null
  filter: string
  setFilter: (v: string) => void
  q: string
  setQ: (v: string) => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        {['active', 'completed', 'released', ''].map((f) => (
          <button
            key={f || 'all'}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition',
              filter === f ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'text-slate-400 border-slate-800 hover:border-slate-600',
            )}
          >
            {f || 'All'}
          </button>
        ))}
        <input className="input flex-1 min-w-[200px]" placeholder="Search VIN, model, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary text-xs" onClick={onNew}>+ New reservation</button>
      </div>

      {reservations === null ? (
        <div className="text-center text-sm text-slate-500 py-10">Loading…</div>
      ) : reservations.length === 0 ? (
        <div className="text-center text-sm text-slate-600 py-10">No reservations found.</div>
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="card w-full p-3 text-left hover:border-brand-500/50 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    {r.bike?.model || 'Bike'} · <span className="font-mono text-xs text-slate-500">{r.bike?.vin}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {r.customer?.full_name} {r.customer?.phone ? `· ${r.customer.phone}` : ''}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5">Reserved {dateTime(r.reserved_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <StatusBadge status={r.status} />
                  <div className="text-sm font-bold text-white mt-1">{ugx(r.total_price)}</div>
                  <div className={cn('text-xs font-semibold', r.balance > 0 ? 'text-amber-300' : 'text-emerald-400')}>
                    Balance {ugx(r.balance)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ReserveForm({
  prefillBike, onDone, onCancel,
}: {
  prefillBike?: Bike | null
  onDone: (msg: string) => void
  onCancel: () => void
}) {
  const [bikeId, setBikeId] = useState(prefillBike?.id || '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [totalPrice, setTotalPrice] = useState(prefillBike ? String(Number(prefillBike.selling_price) || 0) : '')
  const [downPayment, setDownPayment] = useState('')
  const [planMonths, setPlanMonths] = useState('12')
  const [method, setMethod] = useState('cash')
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function pickBike(id: string) {
    setBikeId(id)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!navigator.onLine) {
      setError('Reservations need an internet connection — they lock the bike VIN on the server. Reconnect and try again.')
      return
    }
    const tp = Number(totalPrice)
    const dp = Number(downPayment)
    if (!bikeId) return setError('Select a bike')
    if (!name.trim() || !phone.trim()) return setError('Customer name and phone are required')
    if (!Number.isFinite(tp) || tp <= 0) return setError('Total price must be greater than 0')
    if (!Number.isFinite(dp) || dp <= 0) return setError('Down payment must be greater than 0')
    if (dp > tp) return setError('Down payment cannot exceed total price')
    setBusy(true)
    try {
      const r = await api.createReservation({
        bike_id: bikeId,
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        total_price: tp,
        down_payment: dp,
        plan_months: Number(planMonths) || 0,
        payment_method: method,
        transaction_ref: ref.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      onDone(`Bike reserved — balance ${ugx(r.reservation.balance)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reservation failed')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FieldWrap label="Bike *">
        <BikeSelect bikeId={bikeId} prefillId={prefillBike?.id} onPick={pickBike} />
      </FieldWrap>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldWrap label="Customer name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
        </FieldWrap>
        <FieldWrap label="Customer phone *">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" required />
        </FieldWrap>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldWrap label="Total price (UGX) *">
          <input className="input" type="number" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} required />
        </FieldWrap>
        <FieldWrap label="Down payment (UGX) *">
          <input className="input" type="number" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} required />
        </FieldWrap>
      </div>

      <FieldWrap label="Plan (months)">
        <div className="flex gap-1.5 flex-wrap">
          {PLAN_OPTIONS.map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setPlanMonths(String(m))}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition',
                Number(planMonths) === m ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'text-slate-400 border-slate-800 hover:border-slate-600',
              )}
            >
              {m} mo
            </button>
          ))}
        </div>
      </FieldWrap>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldWrap label="Payment method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label="Reference">
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Receipt / ref no." />
        </FieldWrap>
      </div>

      <FieldWrap label="Notes">
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FieldWrap>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <button type="button" className="btn-ghost w-full sm:w-auto" onClick={onCancel}>Back</button>
        <button className="btn-primary w-full sm:w-auto" disabled={busy}>
          {busy ? 'Reserving…' : 'Take down payment & reserve'}
        </button>
      </div>
    </form>
  )
}

/** Bike picker backed by the local (synced) catalog — in-stock bikes only. */
function BikeSelect({ bikeId, prefillId, onPick }: { bikeId: string; prefillId?: string; onPick: (id: string) => void }) {
  const bikes = useLiveQuery(() => db.bikes.where('status').equals('in_stock').toArray(), [], [] as Bike[])
  const selected = (bikes || []).find((b) => b.id === bikeId)

  if (selected) {
    return (
      <div className="flex items-center justify-between bg-[#0b0e13] rounded-lg px-3 py-2 border border-slate-800/60">
        <span className="text-white text-sm">
          {selected.model} · <span className="font-mono text-xs text-slate-500">{selected.vin}</span>
        </span>
        <button type="button" className="text-xs text-brand-300 underline" onClick={() => onPick('')}>
          change
        </button>
      </div>
    )
  }

  return (
    <select className="input" value={bikeId} onChange={(e) => onPick(e.target.value)}>
      <option value="">{(bikes || []).length === 0 ? 'No in-stock bikes in local catalog — sync first' : '— select an in-stock bike —'}</option>
      {(bikes || []).map((b) => (
        <option key={b.id} value={b.id}>
          {b.model} · {b.vin} · {ugx(b.selling_price)}
        </option>
      ))}
      {prefillId && <option value={prefillId}>{prefillId.slice(0, 8)}… (scanned bike)</option>}
    </select>
  )
}

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

/** One reservation: summary, payment history, record-installment form, actions. */
function DetailPane({
  id,
  canRelease,
  onChanged,
  onBack,
}: {
  id: string
  canRelease: boolean
  onChanged: () => void
  onBack: () => void
}) {
  const [reservation, setReservation] = useState<BikeReservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pay, setPay] = useState({ amount: '', payment_method: 'cash', transaction_ref: '', note: '' })
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.reservationDetail(id)
      setReservation(r.reservation)
      setPay((p) => ({ ...p, amount: r.reservation.balance > 0 ? String(r.reservation.balance) : '' }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reservation')
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const payments = reservation?.reservations_payments || []
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  const balance = reservation?.balance ?? 0
  const active = reservation?.status === 'active'
  const online = navigator.onLine

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amt = Number(pay.amount)
    if (!Number.isFinite(amt) || amt <= 0) return setError('Amount must be greater than 0')
    if (amt > balance) return setError(`Amount exceeds the outstanding balance (${ugx(balance)})`)
    setBusy('pay')
    try {
      const r = await api.recordInstallment(id, {
        amount: amt,
        payment_method: pay.payment_method,
        transaction_ref: pay.transaction_ref || undefined,
        note: pay.note || undefined,
      })
      setPay({ amount: '', payment_method: 'cash', transaction_ref: '', note: '' })
      await load()
      onChanged()
      if (r.balance <= 0.01) setError('') // fully paid — bike marked sold
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    }
    setBusy(null)
  }

  async function complete() {
    if (!window.confirm('Mark this reservation as fully paid? The bike will be marked as sold.')) return
    setBusy('complete')
    try {
      await api.completeReservation(id)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed')
    }
    setBusy(null)
  }

  async function release() {
    const reason = window.prompt('Why is this reservation being released? (optional)')
    if (reason === null) return
    setBusy('release')
    try {
      const r = await api.releaseReservation(id, reason || undefined)
      if (r.pendingApproval) {
        setError('Release request submitted — an admin must approve it before the bike returns to stock.')
      } else {
        await load()
        onChanged()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed')
    }
    setBusy(null)
  }

  if (loading) return <p className="text-sm text-slate-500 text-center py-8">Loading reservation…</p>
  if (!reservation) return <p className="text-sm text-red-400">{error || 'Reservation not found'}</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Total price" value={ugx(reservation.total_price)} />
        <Stat label="Balance" value={ugx(reservation.balance)} />
        <Stat label="Paid so far" value={ugx(paid)} />
        <Stat label="Plan" value={reservation.plan_months ? `${reservation.plan_months} months` : '—'} />
      </div>

      <div className="text-sm space-y-1">
        <div>
          <span className="text-slate-500">Bike</span>{' '}
          <span className="text-white">{reservation.bike?.model} · <span className="font-mono text-xs">{reservation.bike?.vin}</span></span>
        </div>
        <div>
          <span className="text-slate-500">Customer</span>{' '}
          <span className="text-white">{reservation.customer?.full_name || '—'}{reservation.customer?.phone ? ` · ${reservation.customer.phone}` : ''}</span>
        </div>
        <div><span className="text-slate-500">Status</span> <span className="text-white capitalize">{reservation.status}</span></div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Payments</div>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-600">No payments yet.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm bg-[#0b0e13] rounded-lg px-3 py-2 border border-slate-800/60">
                <span className="text-slate-400 text-xs">{new Date(p.created_at).toLocaleDateString()}</span>
                <span className="text-white font-medium">{ugx(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {active && balance > 0 && (
        <form onSubmit={recordPayment} className="space-y-2 border-t border-slate-800/70 pt-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Record installment</div>
          <FieldWrap label="Amount (UGX)">
            <input className="input" type="number" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} required />
          </FieldWrap>
          <div className="grid grid-cols-2 gap-2">
            <FieldWrap label="Method">
              <select className="input" value={pay.payment_method} onChange={(e) => setPay((p) => ({ ...p, payment_method: e.target.value }))}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </FieldWrap>
            <FieldWrap label="Reference">
              <input className="input" value={pay.transaction_ref} onChange={(e) => setPay((p) => ({ ...p, transaction_ref: e.target.value }))} placeholder="Receipt no." />
            </FieldWrap>
          </div>
          <button className="btn-primary w-full" disabled={busy === 'pay' || !online}>
            {busy === 'pay' ? 'Saving…' : !online ? 'Offline — reconnect to record' : 'Save payment'}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button className="btn-ghost flex-1" onClick={onBack}>Back</button>
        {active && balance <= 0 && (
          <button className="btn-primary flex-1" disabled={busy === 'complete' || !online} onClick={complete}>
            {busy === 'complete' ? '…' : 'Complete'}
          </button>
        )}
        {active && canRelease && (
          <button className="btn-ghost flex-1 text-red-300" disabled={busy === 'release' || !online} onClick={release}>
            {busy === 'release' ? '…' : 'Release'}
          </button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-semibold text-white mt-0.5 text-sm">{value}</div>
    </div>
  )
}

