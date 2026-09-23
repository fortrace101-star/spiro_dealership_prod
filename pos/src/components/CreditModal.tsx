import { useCallback, useEffect, useState } from 'react'
import { api, getDeviceId } from '../lib/api'
import { ugx } from '../lib/format'
import { PAYMENT_LABELS, type CreditOutstandingSale, type CreditPendingSale } from '../lib/types'
import { uuid } from '../db/uuid'

/** Settlement methods the server accepts (a credit sale is never a payment). */
const PAY_METHODS = ['cash', 'mobile_money', 'bank', 'card'] as const

interface Props {
  online: boolean
  onClose: () => void
  onBadge: (counts: { awaiting: number; approved: number; rejected: number }) => void
  onFlash: (msg: string) => void
}

function statusPill(s: CreditPendingSale) {
  const approved = s.approval_status === 'approved'
  const rejected = s.approval_status === 'rejected'
  const cls = rejected
    ? 'bg-red-500/15 text-red-300 border-red-500/30'
    : approved
      ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
      : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  const label = rejected ? 'Rejected' : approved ? 'Approved — finalize' : 'Awaiting approval'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}

/** Three disjoint groups the header badge tracks (shared with POSScreen's poll).
 *  Rejected-but-unconfirmed rows arrive in the same pending list (server-held),
 *  so the badge needs no other data source. */
export function creditBadgeCounts(rows: CreditPendingSale[]) {
  return {
    awaiting: rows.filter((s) => s.approval_status === 'pending' || s.approval_status == null).length,
    approved: rows.filter((s) => s.approval_status === 'approved').length,
    rejected: rows.filter((s) => s.approval_status === 'rejected').length,
  }
}

/**
 * POS credit desk — the cashier's approval queue plus the debt they can settle.
 * Accounting rule: checkout records nothing; admin approval only ARMS the sale;
 * the operator's Finalize click deducts stock and opens the debt; each payment
 * dissolves the debt (the debt itself is never revenue). Actions are online-only.
 */
export default function CreditModal({ online, onClose, onBadge, onFlash }: Props) {
  const [pending, setPending] = useState<CreditPendingSale[] | null>(null)
  const [outstanding, setOutstanding] = useState<CreditOutstandingSale[] | null>(null)
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [payFor, setPayFor] = useState<CreditOutstandingSale | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<string>('cash')
  const [note, setNote] = useState('')

  const load = useCallback(
    async (query: string) => {
      const r = await api.creditSales(query)
      setPending(r.pending)
      setOutstanding(r.outstanding)
      // Rejected-but-unconfirmed rows come back inside r.pending too (server-held),
      // so they sit in the queue right next to the approved ones.
      onBadge(creditBadgeCounts(r.pending))
    },
    [onBadge],
  )

  // Debounced load on query change + 20s auto-refresh while the desk is open.
  useEffect(() => {
    const t = setTimeout(() => {
      load(q).catch(() => {
        setPending([])
        setOutstanding([])
      })
    }, 300)
    const iv = setInterval(() => void load(q).catch(() => {}), 20_000)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [q, load])
  /** The operator's explicit completion click — stock deducts here, debt opens. */
  async function finalize(s: CreditPendingSale) {
    setBusyId(s.id)
    setError('')
    try {
      const r = await api.finalizeCredit(s.id, { device_id: getDeviceId(), client_txn_id: `pos-fin-${uuid()}` })
      onFlash(
        r.duplicate
          ? `${s.receipt_no} was already finalized`
          : `${s.receipt_no} finalized — stock deducted, debt open`,
      )
      await load(q)
    } catch (err) {
      // 409 surfaces sold-out / not-approved / rejected — stock never goes negative.
      setError(err instanceof Error ? err.message : 'Finalize failed')
      await load(q).catch(() => {})
    } finally {
      setBusyId(null)
    }
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payFor) return
    setError('')
    const amt = Number(amount)
    const bal = Number(payFor.balance)
    if (!Number.isFinite(amt) || amt <= 0) return setError('Enter an amount greater than zero')
    if (amt > bal + 0.009) return setError(`Payment exceeds the balance of ${ugx(bal)}`)
    setBusyId(payFor.id)
    try {
      const r = await api.creditPayment(payFor.id, {
        amount: Math.round(amt),
        payment_method: method,
        note: note.trim() || undefined,
        device_id: getDeviceId(),
        client_txn_id: `pos-pay-${uuid()}`,
      })
      onFlash(
        r.duplicate
          ? 'Payment was already recorded'
          : r.status === 'settled'
            ? `${payFor.receipt_no} settled in full 🎉`
            : `Payment received — balance ${ugx(Number(r.balance))}`,
      )
      setPayFor(null)
      setNote('')
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setBusyId(null)
    }
  }

  /** Rejected sales stay in this queue until the operator confirms reception —
   *  server-held acknowledged_at gives them the same persistence Finalize gives
   *  approved sales (visible on any terminal, survives reloads). */
  async function confirmRejection(s: CreditPendingSale) {
    setBusyId(s.id)
    setError('')
    try {
      await api.ackCreditRejection(s.id)
      onFlash(`${s.receipt_no} — rejection confirmed, cleared from the queue`)
      await load(q)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm reception')
      await load(q).catch(() => {})
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative w-full max-w-lg h-full bg-[#111814] border-l border-slate-800 p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-white">Credit desk</h3>
          <button className="text-slate-500 hover:text-white text-xl" onClick={onClose}>×</button>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">
          {online
            ? 'Approval arms the sale → Finalize deducts stock and opens the debt → payments settle it.'
            : 'Offline — the desk is read-only until the connection returns.'}
        </p>

        {error && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {/* Approval queue — awaiting decision, ready to finalize, or awaiting the
            operator's confirmation of a rejection (rejected rows persist here
            server-side until Confirm received, like approved rows until Finalize). */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Approval queue</h4>
          <span className="text-[11px] text-slate-600">{pending ? `${pending.length} sale(s)` : '…'}</span>
        </div>
        {pending === null ? (
          <div className="text-sm text-slate-600 mb-6">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-slate-600 mb-6">No credit sales in flight. 🎉</div>
        ) : (
          <div className="space-y-2 mb-6">
            {pending.map((s) => (
              <div key={s.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-brand-300">{s.receipt_no}</span>
                  <span className="font-bold text-white">{ugx(Number(s.total))}</span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>
                    {s.customer_name || 'Walk-in'}
                    {s.customer_phone ? ` · ${s.customer_phone}` : ''}
                  </span>
                  <span>
                    {new Date(s.created_at).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                {s.approval_status === 'rejected' && (
                  <div className="text-[11px] text-red-300 mt-1">
                    Rejected — do not release the goods (nothing was recorded)
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  {statusPill(s)}
                  {s.approval_status === 'approved' && (
                    <button
                      className="btn-primary text-xs px-3 py-1.5"
                      disabled={!online || busyId === s.id}
                      title={online ? 'Deduct stock and open the debt' : 'Finalize needs a connection'}
                      onClick={() => void finalize(s)}
                    >
                      {busyId === s.id ? 'Finalizing…' : 'Finalize'}
                    </button>
                  )}
                  {s.approval_status === 'rejected' && (
                    <button
                      className="btn-ghost text-xs px-3 py-1.5 border border-red-500/40 text-red-300"
                      disabled={!online || busyId === s.id}
                      title={
                        online
                          ? 'Acknowledges the rejection — clears it from the queue on every terminal'
                          : 'Confirming needs a connection'
                      }
                      onClick={() => void confirmRejection(s)}
                    >
                      {busyId === s.id ? 'Confirming…' : 'Confirm received'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Outstanding debt — settle part or all (revenue recognized on payment day) */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Outstanding debt</h4>
        </div>
        <input
          className="input w-full mb-2"
          placeholder="Search receipt / customer / phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {outstanding === null ? (
          <div className="text-sm text-slate-600">Loading…</div>
        ) : outstanding.length === 0 ? (
          <div className="text-sm text-slate-600">No outstanding credit debt.</div>
        ) : (
          <div className="space-y-2">
            {outstanding.map((s) => (
              <div key={s.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-brand-300">{s.receipt_no}</span>
                  <span className="text-sm font-bold text-white">balance {ugx(Number(s.balance))}</span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                  <span>
                    {s.customer_name || 'Walk-in'}
                    {s.customer_phone ? ` · ${s.customer_phone}` : ''}
                  </span>
                  <span>
                    paid {ugx(Number(s.paid))} of {ugx(Number(s.total))}
                  </span>
                </div>

                {payFor?.id === s.id ? (
                  <form onSubmit={submitPayment} className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        step={1}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={`Amount (max ${Math.round(Number(s.balance))})`}
                        autoFocus
                      />
                      <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                        {PAY_METHODS.map((m) => (
                          <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      className="input w-full"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (optional)"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => {
                          setPayFor(null)
                          setError('')
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary text-xs"
                        disabled={!online || busyId === s.id}
                        title={online ? undefined : 'Payments need a connection'}
                      >
                        {busyId === s.id ? 'Saving…' : 'Record payment'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex justify-end mt-2">
                    <button
                      className="btn-ghost text-xs"
                      disabled={!online}
                      title={online ? 'Receive part or all of this debt' : 'Payments need a connection'}
                      onClick={() => {
                        setPayFor(s)
                        setAmount(String(Math.round(Number(s.balance))))
                        setError('')
                      }}
                    >
                      Receive payment
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}