import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { compactUgx, dateTime, PAYMENT_LABELS, ugx } from '../lib/format'
import type { CreditLedgerSale } from '../lib/types'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Modal } from '../components/Modal'
import { Field } from './InventoryPage'
import { cn } from '../lib/cn'
import { usePageSize } from '../lib/usePageSize'

type View = 'outstanding' | 'pending' | 'settled'

const VIEWS: { key: View; label: string; empty: string }[] = [
  { key: 'outstanding', label: 'Outstanding debt', empty: 'No outstanding credit debt — every finalized sale is settled.' },
  { key: 'pending', label: 'Pending approval', empty: 'No credit sales awaiting approval.' },
  { key: 'settled', label: 'Settled', empty: 'No settled credit sales yet.' },
]

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
]

function statusPill(s: CreditLedgerSale) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    outstanding: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    settled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  }
  const pending = s.status === 'pending_credit'
  const label = pending ? 'Pending approval' : Number(s.balance) > 0.009 ? 'Outstanding' : 'Settled'
  const kind = pending ? 'pending' : Number(s.balance) > 0.009 ? 'outstanding' : 'settled'
  return (
    <span className={'inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap ' + map[kind]}>
      {label}
    </span>
  )
}

const canPay = (s: CreditLedgerSale) => s.status === 'completed' && Number(s.balance) > 0.009

/** Receive part of a credit debt — the back-office twin of the POS payment modal. */
function ReceivePayment({ sale, onClose, onSaved }: { sale: CreditLedgerSale; onClose: () => void; onSaved: () => void }) {
  const bal = Number(sale.balance)
  const [amount, setAmount] = useState(String(bal))
  const [method, setMethod] = useState('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return setError('Enter an amount greater than zero')
    if (amt > bal + 0.009) return setError(`Payment exceeds the balance of ${ugx(bal)}`)
    setBusy(true)
    try {
      await api.creditPayment(sale.id, {
        amount: Math.round(amt),
        payment_method: method,
        note: note.trim() || undefined,
        client_txn_id: `adm-${crypto.randomUUID()}`,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Receive payment — ${sale.receipt_no}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-xs text-slate-400">
          Balance due: <span className="text-white font-semibold">{ugx(bal)}</span>
        </div>
        <Field label="Amount *">
          <input className="input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
        </div>
      </form>
    </Modal>
  )
}
export default function CreditPage() {
  // Deep links: /credit?view=pending|settled open that tab (Overview/Approvals drill-ins).
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    return v === 'pending' || v === 'settled' ? v : 'outstanding'
  })
  const [sales, setSales] = useState<CreditLedgerSale[] | null>(null)
  const [detail, setDetail] = useState<CreditLedgerSale | null>(null)
  const [paying, setPaying] = useState<CreditLedgerSale | null>(null)
  const [page, setPage] = useState(1)
  // Search: customer name/phone or receipt (q) + sale-date range — for payment
  // queries and verification. Server-side, applied within the active view.
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    const r = await api.creditLedger(view, { q, from: from || undefined, to: to || undefined })
    setSales(r.sales)
    return r.sales
  }, [view, q, from, to])

  // Debounced (re)load on view/search change; resets paging and the open drawer.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setDetail(null)
      load().catch(() => setSales([]))
    }, 300)
    return () => clearTimeout(t)
  }, [load])

  // After a payment: refresh the list and the open drawer so Balance/Paid update live.
  async function saved() {
    const fresh = await load().catch(() => null)
    setPaying(null)
    if (detail && fresh) setDetail(fresh.find((s) => s.id === detail.id) || null)
  }

  const totals = (sales || []).reduce(
    (acc, s) => ({
      total: acc.total + Number(s.total),
      paid: acc.paid + Number(s.paid),
      balance: acc.balance + Number(s.balance),
    }),
    { total: 0, paid: 0, balance: 0 },
  )

  const totalPages = Math.max(1, Math.ceil((sales?.length || 0) / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = (sales || []).slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeFrom = (sales?.length || 0) === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeTo = Math.min(safePage * pageSize, sales?.length || 0)

  return (
    <div>
      <PageHeader title="Credit" subtitle="Credit sales awaiting approval, outstanding debt and settlements" />

      {/* View tabs (Outstanding / Pending / Settled) + running totals */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={cn('btn-ghost text-xs', view === v.key && 'bg-slate-700 text-white')}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {view === v.key && sales ? <span className="ml-1.5 opacity-70">({sales.length})</span> : null}
          </button>
        ))}
        {sales && sales.length > 0 && (
          <span className="text-xs text-slate-500 ml-auto tabular-nums">
            Total {compactUgx(totals.total)} · Paid {compactUgx(totals.paid)} · Balance {compactUgx(totals.balance)}
          </span>
        )}
      </div>

      {/* Search: name/phone/receipt + date range (server-side, within the active view) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="Search customer, phone or receipt…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input className="input w-auto text-xs" type="date" title="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-xs text-slate-500">to</span>
        <input className="input w-auto text-xs" type="date" title="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        {(q || from || to) && (
          <button
            className="btn-ghost text-xs"
            onClick={() => {
              setQ('')
              setFrom('')
              setTo('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {sales === null ? (
          <Spinner />
        ) : sales.length === 0 ? (
          <EmptyState message={VIEWS.find((v) => v.key === view)?.empty || 'No credit sales.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Receipt</th>
                  <th className="th col-opt text-right">Total</th>
                  <th className="th col-opt text-right">Paid</th>
                  <th className="th text-right">Balance</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/30 cursor-pointer" onClick={() => setDetail(s)}>
                    <td className="td">
                      <div className="font-mono text-xs text-brand-300">{s.receipt_no}</div>
                      <div className="text-[11px] text-slate-500">{s.customer_name || 'Walk-in'}{s.customer_phone ? ` · ${s.customer_phone}` : ''}</div>
                    </td>
                    <td className="td col-opt text-right text-slate-400 tabular-nums whitespace-nowrap">
                      <span className="sm:hidden">{compactUgx(s.total)}</span>
                      <span className="hidden sm:inline">{ugx(s.total)}</span>
                    </td>
                    <td className="td col-opt text-right text-emerald-300 tabular-nums whitespace-nowrap">
                      <span className="sm:hidden">{compactUgx(s.paid)}</span>
                      <span className="hidden sm:inline">{ugx(s.paid)}</span>
                    </td>
                    <td className="td text-right font-semibold text-white tabular-nums whitespace-nowrap">
                      <span className="sm:hidden">{compactUgx(s.balance)}</span>
                      <span className="hidden sm:inline">{ugx(s.balance)}</span>
                    </td>
                    <td className="td">{statusPill(s)}</td>
                    <td className="td text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {canPay(s) && (
                        <button className="btn-ghost text-xs px-2 py-1" onClick={() => setPaying(s)}>Receive</button>
                      )}
                      <span className="sm:hidden text-slate-600 text-xs ml-1" onClick={() => setDetail(s)}>›</span>
                    </td>
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
      {/* Detail drawer — totals, status and the payment history */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="font-mono text-brand-300 text-lg">{detail.receipt_no}</div>
                <div className="text-xs text-slate-500">
                  {detail.customer_name || 'Walk-in'}{detail.customer_phone ? ` · ${detail.customer_phone}` : ''} · {dateTime(detail.created_at)}
                </div>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Total</div>
                <div className="text-sm font-semibold text-white">{ugx(detail.total)}</div>
              </div>
              <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Paid</div>
                <div className="text-sm font-semibold text-emerald-300">{ugx(detail.paid)}</div>
              </div>
              <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Balance</div>
                <div className="text-sm font-semibold text-white">{ugx(detail.balance)}</div>
              </div>
            </div>

            <div className="mb-4">{statusPill(detail)}</div>

            {/* What was taken on credit — the line items from the POS checkout */}
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Items taken</h4>
            {detail.items.length === 0 ? (
              <div className="text-xs text-slate-600 mb-4">No line items recorded for this sale.</div>
            ) : (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 mb-4">
                {detail.items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-white truncate">{it.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {it.kind === 'bike' ? 'E-bike' : 'Part'} · {ugx(it.unit_price)} × {it.qty}
                      </div>
                    </div>
                    <div className="text-slate-300 tabular-nums whitespace-nowrap">{ugx(it.line_total)}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-400 bg-[#0b0e13]">
                  <span>Items total</span>
                  <span className="tabular-nums">{ugx(detail.items.reduce((a, it) => a + Number(it.line_total), 0))}</span>
                </div>
              </div>
            )}

            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Payment history</h4>
            {detail.payments.length === 0 ? (
              <div className="text-xs text-slate-600 mb-4">No payments received yet.</div>
            ) : (
              <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 mb-4">
                {detail.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div>
                      <div className="text-white">{ugx(p.amount)}</div>
                      <div className="text-[11px] text-slate-500">
                        {PAYMENT_LABELS[p.payment_method] || p.payment_method}{p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 text-right whitespace-nowrap">{dateTime(p.created_at)}</div>
                  </div>
                ))}
              </div>
            )}

            {canPay(detail) && (
              <div className="flex justify-end">
                <button className="btn-primary text-sm" onClick={() => setPaying(detail)}>Receive payment</button>
              </div>
            )}
          </div>
        </div>
      )}

      {paying && (
        <ReceivePayment sale={paying} onClose={() => setPaying(null)} onSaved={() => void saved()} />
      )}
    </div>
  )
}
