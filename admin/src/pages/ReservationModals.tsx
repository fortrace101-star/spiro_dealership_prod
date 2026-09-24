import { useCallback, useEffect, useState } from 'react'
import { useIsPhone } from '../lib/usePageSize'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { dateShort, dateTime, num, PAYMENT_LABELS, timeShort, ugx } from '../lib/format'
import type { Bike, BikeReservation, Customer } from '../lib/types'
import { Badge, badgeTint, EmptyState, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

const PLAN_OPTIONS = [3, 6, 9, 12, 18, 24]
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'credit', label: 'Credit' },
]

interface ReserveForm {
  bike_id: string
  customer_id: string
  total_price: string
  down_payment: string
  plan_months: string
  payment_method: string
  transaction_ref: string
  notes: string
}

/** List + filters for the reservations tab. */
export function ReservationsTabContent({
  reservations,
  resFilter,
  setResFilter,
  resQ,
  setResQ,
  onReserve,
  onOpenDetail,
}: {
  reservations: BikeReservation[] | null
  resFilter: string
  setResFilter: (v: string) => void
  resQ: string
  setResQ: (v: string) => void
  onReserve: () => void
  onOpenDetail: (id: string) => void
}) {
  const phone = useIsPhone()
  return (
    <div>
      {/* Filters — same responsive structure as the Sales/Bikes filter card:
          Row 1: titled Status picker (compact text, short label on phone).
          Row 2: search fills remaining space + Search button pinned right;
                  count sits one rhythm-step below the search field.
          + Reserve bike keeps its own row below so it stays a prominent
          action rather than crowding the filter row. */}
      <div className="card p-4 mb-4 space-y-3">
        {/* Row 1: titled Status picker */}
        <Field label="Status" className="w-full">
          <select className="input w-full truncate text-[13px] sm:text-sm" value={resFilter} onChange={(e) => setResFilter(e.target.value)}>
            <option value="">{phone ? 'All' : 'All statuses'}</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="released">Released</option>
            <option value="expired">Expired</option>
          </select>
        </Field>

        <form
          className="flex flex-wrap gap-3 items-start"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex-1 min-w-0">
            <input
              className="input w-full text-[13px] sm:text-sm"
              aria-label="Search reservations"
              placeholder={phone ? 'Search…' : 'Search VIN, model, customer…'}
              value={resQ}
              onChange={(e) => setResQ(e.target.value)}
            />
            {reservations && <div className="mt-3 text-xs text-slate-500">{reservations.length} reservations</div>}
          </div>
          <button type="submit" className="btn-primary text-xs px-5">Search</button>
        </form>
      </div>

      <button className="btn-primary w-full sm:w-auto mb-4" onClick={onReserve}>
        + Reserve bike
      </button>

      {/* Color key for the mobile status dots (PC shows the Badge instead) — sits above the table */}
      <div className="sm:hidden mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Active</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" />Released</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400" />Expired</span>
      </div>

      <div className="card overflow-hidden">
        {reservations === null ? (
          <Spinner />
        ) : reservations.length === 0 ? (
          <EmptyState message="No reservations yet. Reserve a bike with a down payment to start selling on installments." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {/* Phones: Model over (dot + VIN) as one cell; sm+: separate Status and Bike columns */}
                  <th className="th sm:hidden">Bike</th>
                  <th className="th col-opt">Status</th>
                  <th className="th col-opt">Bike</th>
                  <th className="th">Customer</th>
                  <th className="th">Reserved</th>
                  {/* Phones: one stacked Paid/Total/Balance cell; sm+: separate columns */}
                  <th className="th text-right sm:hidden">
                    <div>Total</div>
                    <div className="border-t border-slate-800/80 my-1" />
                    <div className="text-emerald-300">Paid</div>
                    <div className="border-t border-slate-800/80 my-1" />
                    {/* Balance label mirrors the entries: red while outstanding, emerald once settled */}
                    <div className={reservations?.some((r) => Number(r.balance) > 0) ? 'text-red-300' : 'text-emerald-400'}>Balance</div>
                  </th>
                  <th className="th col-opt text-right">Plan</th>
                  <th className="th col-opt text-right">Total</th>
                  <th className="th col-opt text-right">Down</th>
                  <th className="th col-opt text-right">Balance</th>
                  <th className="th col-opt text-right">Paid</th>
                  {/* No Actions column: rows are clickable and open the detail modal */}
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const paid = (r.reservations_payments || []).reduce((s: number, p) => s + p.amount, 0)
                  const balance = r.balance
                  const outstanding = balance > 0
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/30 align-top cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                      {/* Phones: Model over (status dot + VIN) — same stack as the modal's Bike field */}
                      <td className="td text-xs sm:hidden">
                        {r.bike?.model && <div className="font-medium text-white">{r.bike.model}</div>}
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', STATUS_DOT[r.status] || 'bg-slate-400')} title={r.status} />
                          <span className="font-mono text-brand-300">{r.bike?.vin || `${r.bike_id.slice(0, 8)}…`}</span>
                        </div>
                      </td>
                      <td className="td col-opt text-xs whitespace-nowrap">
                        <Badge kind={r.status}>{r.status}</Badge>
                      </td>
                      {/* sm+ up: Model over VIN, same stack as the modal's Bike field (Status badge is its own column) */}
                      <td className="td col-opt text-xs">
                        {r.bike?.model && <div className="font-medium text-white">{r.bike.model}</div>}
                        <div className="font-mono text-brand-300 break-all">{r.bike?.vin || `${r.bike_id.slice(0, 8)}…`}</div>
                      </td>
                      <td className="td text-xs text-slate-300">
                        {r.customer?.full_name || '—'}
                        {r.customer?.phone && <span className="block text-slate-500 text-[11px]">{r.customer.phone}</span>}
                      </td>
                      {/* Phones: date over time ("22 Sep" / "22:10"); sm+: full dateTime */}
                      <td className="td text-xs text-slate-400 whitespace-nowrap">
                        <span className="sm:hidden block">{dateShort(r.reserved_at)}</span>
                        <span className="sm:hidden block">{timeShort(r.reserved_at)}</span>
                        <span className="hidden sm:inline">{dateTime(r.reserved_at)}</span>
                      </td>
                      {/* Phones: Total over Paid, then Balance as the next row (same stack as Inventory Cost/Price) */}
                      <td className="td text-xs text-right tabular-nums whitespace-nowrap sm:hidden">
                        <div>{ugx(r.total_price)}</div>
                        <div className="border-t border-slate-800/80 my-1" />
                        <div className="text-emerald-300">{ugx(paid)}</div>
                        <div className="border-t border-slate-800/80 my-1" />
                        <div className={cn('font-semibold', outstanding ? 'text-red-300' : 'text-emerald-400')}>
                          {ugx(balance)}
                        </div>
                      </td>
                      <td className="td col-opt text-xs text-right tabular-nums whitespace-nowrap">
                        {r.plan_months ? `${num(r.plan_months)} mo` : '—'}
                      </td>
                      <td className="td col-opt text-xs text-right tabular-nums whitespace-nowrap">{ugx(r.total_price)}</td>
                      <td className="td col-opt text-xs text-right tabular-nums whitespace-nowrap">{ugx(r.down_payment)}</td>
                      <td className="td col-opt text-xs text-right tabular-nums whitespace-nowrap">
                        <span className={cn('font-semibold', outstanding ? 'text-red-300' : 'text-emerald-400')}>
                          {ugx(balance)}
                        </span>
                      </td>
                      <td className="td col-opt text-xs text-right tabular-nums whitespace-nowrap">{ugx(paid)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Dot fill per reservation status — mirrors BADGE_COLORS in ui.tsx (phones only). */
const STATUS_DOT: Record<string, string> = {
  active: 'bg-amber-400',
  completed: 'bg-emerald-400',
  released: 'bg-slate-400',
  expired: 'bg-red-400',
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className="font-semibold text-white mt-0.5 break-words text-sm">{value}</div>
    </div>
  )
}

/** Modal: reserve an in-stock bike for a customer with a down payment. */
export function ReserveBikeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<ReserveForm>({
    bike_id: '',
    customer_id: '',
    total_price: '',
    down_payment: '',
    plan_months: '12',
    payment_method: 'cash',
    transaction_ref: '',
    notes: '',
  })
  const [bikes, setBikes] = useState<Bike[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [customerQuery, setCustomerQuery] = useState('')
  // Radio choice mirrors the POS checkout modal: pick a registered customer
  // from the database, or type a walk-in's name + phone directly (the server
  // creates/attaches them at submit, so cash buyers can reserve too).
  const [customerMode, setCustomerMode] = useState<'registered' | 'new'>('registered')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      setLoadingData(true)
      try {
        const [b, c] = await Promise.all([api.bikes('', 'in_stock'), api.customers('')])
        setBikes(b.bikes)
        setCustomers(c.customers)
      } catch {
        setBikes([])
        setCustomers([])
      }
      setLoadingData(false)
    })()
  }, [])

  const selectedBike = bikes.find((b) => b.id === form.bike_id)
  const selectedCustomer = customers.find((c) => c.id === form.customer_id)

  function pickBike(id: string) {
    const b = bikes.find((x) => x.id === id)
    setForm((f) => ({ ...f, bike_id: id, total_price: b ? String(Number(b.selling_price) || 0) : '' }))
  }

  const customerMatches = customers.filter((c) => {
    const q = customerQuery.toLowerCase()
    if (!q) return true
    return c.full_name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q)
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const tp = Number(form.total_price)
    const dp = Number(form.down_payment)
    if (!form.bike_id) return setError('Select a bike')
    if (customerMode === 'registered') {
      if (!form.customer_id) return setError('Select a customer')
    } else if (!newName.trim() || !newPhone.trim()) {
      return setError('Customer name and phone are required')
    }
    if (!Number.isFinite(tp) || tp <= 0) return setError('Total price must be greater than 0')
    if (!Number.isFinite(dp) || dp <= 0) return setError('Down payment must be greater than 0')
    if (dp > tp) return setError('Down payment cannot exceed total price')
    setBusy(true)
    try {
      await api.createReservation({
        bike_id: form.bike_id,
        ...(customerMode === 'new'
          ? { customer_name: newName.trim(), customer_phone: newPhone.trim() }
          : { customer_id: form.customer_id }),
        total_price: tp,
        down_payment: dp,
        plan_months: Number(form.plan_months) || 0,
        payment_method: form.payment_method,
        transaction_ref: form.transaction_ref,
        notes: form.notes,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reservation failed')
    }
    setBusy(false)
  }

  return (
    <Modal title="Reserve bike — installment plan" onClose={onClose}>
      {loadingData ? (
        <Spinner />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Bike *">
            <select className="input" value={form.bike_id} onChange={(e) => pickBike(e.target.value)} required>
              <option value="">— select an in-stock bike —</option>
              {bikes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.model} · {b.vin} · {b.color || 'no colour'}
                </option>
              ))}
            </select>
          </Field>
          {selectedBike && (
            <p className="text-xs text-slate-500">
              Selling price: <span className="text-white">{ugx(selectedBike.selling_price)}</span>
            </p>
          )}

          <Field label="Customer *">
            {/* Radio row mirrors the POS checkout modal: pull from the database,
                or type a walk-in's details straight in. */}
            <div className="flex flex-wrap gap-4 mb-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="reserve-customer-type"
                  checked={customerMode === 'registered'}
                  onChange={() => {
                    setCustomerMode('registered')
                    setNewName('')
                    setNewPhone('')
                  }}
                  className="w-4 h-4 text-brand-500 border-slate-600 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition">Registered customer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="reserve-customer-type"
                  checked={customerMode === 'new'}
                  onChange={() => {
                    setCustomerMode('new')
                    setForm((f) => ({ ...f, customer_id: '' }))
                  }}
                  className="w-4 h-4 text-brand-500 border-slate-600 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition">New customer</span>
              </label>
            </div>
            {customerMode === 'new' ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  required
                />
                <input
                  className="input"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Phone"
                  required
                />
              </div>
            ) : form.customer_id ? (
              <div className="flex items-center justify-between bg-[#0b0e13] rounded-lg px-3 py-2 border border-slate-800/60">
                <span className="text-white">{selectedCustomer?.full_name}</span>
                <button className="text-xs text-brand-300 underline" type="button" onClick={() => setForm((f) => ({ ...f, customer_id: '' }))}>
                  change
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Type to search existing customers…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                <div className="border border-slate-800/60 rounded-lg overflow-hidden max-h-40 mt-1">
                  {customerMatches.length === 0 ? (
                    <p className="p-2 text-xs text-slate-500">
                      No matches — switch to <span className="text-slate-300">New customer</span> above to add them now.
                    </p>
                  ) : (
                    customerMatches.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800/40"
                        onClick={() => setForm((f) => ({ ...f, customer_id: c.id }))}
                      >
                        {c.full_name}{' '}
                        <span className="text-slate-500">· {c.phone || ''}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Total price (UGX) * (locked)">
              <input className="input" type="number" value={form.total_price} readOnly required title="Locked: the total price mirrors the selected bike's catalog price" />
            </Field>
            <Field label="Down payment (UGX) *">
              <input className="input" type="number" value={form.down_payment} onChange={(e) => setForm((f) => ({ ...f, down_payment: e.target.value }))} required />
            </Field>
          </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Plan (months)">
              <input
                className="input"
                type="number"
                value={form.plan_months}
                onChange={(e) => setForm((f) => ({ ...f, plan_months: e.target.value }))}
              />
              <div className="flex gap-1 mt-1 flex-wrap">
                {PLAN_OPTIONS.map((m) => (
                  <button
                    type="button"
                    key={m}
                    className="text-[10px] px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-700"
                    onClick={() => setForm((f) => ({ ...f, plan_months: String(m) }))}
                  >
                    {m} mo
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Payment method">
              <select
                className="input"
                value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference">
              <input
                className="input"
                value={form.transaction_ref}
                onChange={(e) => setForm((f) => ({ ...f, transaction_ref: e.target.value }))}
                placeholder="Receipt / ref no."
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-ghost w-full sm:w-auto" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary w-full sm:w-auto" disabled={busy}>
              {busy ? 'Reserving…' : 'Reserve bike'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// Modal: reservation detail — payment history, record installment, complete/release.
export function ReservationDetailModal({
  id,
  onClose,
  onUpdated,
}: {
  id: string
  onClose: () => void
  onUpdated: () => void
}) {
  const [reservation, setReservation] = useState<BikeReservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', transaction_ref: '', note: '' })
  const [payBusy, setPayBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [releasePassword, setReleasePassword] = useState('')
  const [releaseErr, setReleaseErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.reservation(id)
      setReservation(r.reservation)
      setPayForm((p) => ({ ...p, amount: r.reservation.balance > 0 ? String(r.reservation.balance) : '' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const payments = reservation?.reservations_payments || []
  const paid = payments.reduce((s: number, p) => s + p.amount, 0)
  const balance = reservation ? reservation.balance : 0
  const active = reservation?.status === 'active'

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amt = Number(payForm.amount)
    if (!Number.isFinite(amt) || amt <= 0) return setError('Amount must be greater than 0')
    if (amt > balance) return setError(`Amount exceeds the outstanding balance (${ugx(balance)})`)
    setPayBusy(true)
    try {
      await api.addReservationPayment(id, {
        amount: amt,
        payment_method: payForm.payment_method,
        transaction_ref: payForm.transaction_ref || undefined,
        note: payForm.note || undefined,
      })
      setPayForm({ amount: '', payment_method: 'cash', transaction_ref: '', note: '' })
      await load()
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    }
    setPayBusy(false)
  }

  async function complete() {
    if (!window.confirm('Mark this reservation as fully paid? The bike will be marked as sold.')) return
    setActionBusy('complete')
    try {
      await api.completeReservation(id)
      await load()
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed')
    }
    setActionBusy(null)
  }

  /** Opens the release confirmation — the password check gates the actual action. */
  function openRelease() {
    setReleaseErr('')
    setReleasePassword('')
    setReleaseNote('')
    setReleaseOpen(true)
  }

  async function submitRelease(e: React.FormEvent) {
    e.preventDefault()
    setReleaseErr('')
    if (!releasePassword) {
      setReleaseErr('Enter your password to verify your identity')
      return
    }
    setActionBusy('release')
    try {
      await api.releaseReservation(id, { note: releaseNote.trim() || undefined, password: releasePassword })
      setReleaseOpen(false)
      setReleasePassword('')
      await load()
      onUpdated()
    } catch (err) {
      setReleaseErr(err instanceof Error ? err.message : 'Release failed')
    }
    setActionBusy(null)
  }

  const title = reservation
    ? `Reservation — ${reservation.bike?.model || 'Bike'}`
        : `Reservation — ${id.slice(0, 8)}…`

  return (
    <Modal title={title} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !reservation ? (
        error ? <p className="text-sm text-red-400">{error}</p> : null
      ) : (
        <div className="space-y-4">
          <div>
            {/* Bike field: model above the VIN */}
            <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl px-3 py-2 mb-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Bike</div>
              <div className="text-sm font-medium text-white">{reservation.bike?.model || 'Bike'}</div>
              <div className="text-xs font-mono text-brand-300 break-all">{reservation.bike?.vin || '—'}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Summary label="Total price" value={ugx(reservation.total_price)} />
              <Summary label="Paid Amount" value={ugx(payments.reduce((s, p) => s + Number(p.amount), 0))} />
              <Summary label="Balance" value={ugx(reservation.balance)} />
              <Summary label="Plan" value={reservation.plan_months ? `${num(reservation.plan_months)} months` : '—'} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mt-3">
              <div className={cn('border rounded-xl p-3', badgeTint(reservation.status).card)}>
                <div className="text-xs text-slate-500">Status</div>
                <div className={cn('font-medium capitalize', badgeTint(reservation.status).text)}>{reservation.status.replace('_', ' ')}</div>
              </div>
              <div>
                <span className="text-slate-500">Reserved</span>{' '}
                <span className="text-white font-medium">{dateTime(reservation.reserved_at)}</span>
              </div>
              <div>
                <span className="text-slate-500">Customer</span>{' '}
                <span className="text-white font-medium">
                  {reservation.customer?.full_name || '—'}
                  {reservation.customer?.phone && <span className="text-slate-500"> · {reservation.customer.phone}</span>}
                </span>
              </div>
              {reservation.completed_at && (
                <div>
                  <span className="text-slate-500">Completed</span>{' '}
                  <span className="text-white font-medium">{dateTime(reservation.completed_at)}</span>
                </div>
              )}
              {reservation.released_at && (
                <div>
                  <span className="text-slate-500">Released</span>{' '}
                  <span className="text-white font-medium">{dateTime(reservation.released_at)}</span>
                </div>
              )}
            </div>
          </div>
                    <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Payment history</div>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-600">No payments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th">Date</th>
                      <th className="th">Method</th>
                      <th className="th text-right">Amount</th>
                      <th className="th">Paid by</th>
                      <th className="th">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="td text-xs text-slate-400 whitespace-nowrap">{dateTime(p.created_at)}</td>
                        <td className="td text-xs whitespace-nowrap">{PAYMENT_LABELS[p.payment_method] || p.payment_method}</td>
                        <td className="td text-xs text-right tabular-nums whitespace-nowrap">{ugx(p.amount)}</td>
                        <td className="td text-xs text-slate-400">{p.paid_by_name || '—'}</td>
                        <td className="td text-xs text-slate-500 font-mono">{p.transaction_ref || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {active && balance > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Record installment</div>
              <form onSubmit={recordPayment} className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <Field label="Amount (UGX) *">
                  <input className="input" type="number" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} required autoFocus />
                </Field>
                <Field label="Method">
                  <select className="input" value={payForm.payment_method} onChange={(e) => setPayForm((p) => ({ ...p, payment_method: e.target.value }))}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference">
                  <input className="input" value={payForm.transaction_ref} onChange={(e) => setPayForm((p) => ({ ...p, transaction_ref: e.target.value }))} placeholder="Receipt / ref no." />
                </Field>
                <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-slate-500">
                    <span className="block sm:inline">
                      Outstanding: <span className="text-white font-semibold">{ugx(balance)}</span>
                    </span>
                    <span className="hidden sm:inline sm:mx-1">·</span>
                    <span className="block sm:inline">
                      Paid: <span className="text-emerald-300">{ugx(paid)}</span>
                    </span>
                  </span>
                  <button className="btn-primary w-full sm:w-auto" disabled={payBusy}>{payBusy ? 'Saving…' : 'Save payment'}</button>
                </div>
              </form>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {active && (
              <>
                {balance <= 0 && (
                  <button className="btn-primary w-full sm:w-auto" disabled={actionBusy === 'complete'} onClick={complete}>
                    {actionBusy === 'complete' ? 'Completing…' : 'Mark as complete (bought)'}
                  </button>
                )}
                <button className="btn-danger w-full sm:w-auto" disabled={actionBusy === 'release'} onClick={openRelease}>
                  {actionBusy === 'release' ? 'Releasing…' : 'Release reservation'}
                </button>
              </>
            )}
            <button className="btn-ghost w-full sm:w-auto" onClick={onClose}>Close</button>
          </div>
        </div>
      )}

      {/* Release confirmation — password must verify identity before the action proceeds */}
      {releaseOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => actionBusy !== 'release' && setReleaseOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <form onSubmit={submitRelease} className="relative card w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white mb-1">Release this reservation?</div>
            <p className="text-xs text-slate-500 mb-3">
              The bike returns to stock. Enter your password to verify your identity before the action proceeds.
            </p>
            <div className="space-y-3">
              <Field label="Reason (optional)">
                <input className="input" value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} placeholder="Why is it being released?" />
              </Field>
              <Field label="Your password *">
                <input className="input" type="password" value={releasePassword} onChange={(e) => setReleasePassword(e.target.value)} required autoFocus />
              </Field>
            </div>
            {releaseErr && <p className="text-xs text-red-400 mt-2">{releaseErr}</p>}
            <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost w-full sm:w-auto" disabled={actionBusy === 'release'} onClick={() => setReleaseOpen(false)}>Cancel</button>
              <button className="btn-danger w-full sm:w-auto" disabled={actionBusy === 'release'}>
                {actionBusy === 'release' ? 'Verifying…' : 'Confirm release'}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  )
}
