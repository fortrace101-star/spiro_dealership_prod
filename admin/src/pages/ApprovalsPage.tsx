import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, ugx } from '../lib/format'
import type { Approval } from '../lib/types'
import { usePageSize } from '../lib/usePageSize'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Modal } from '../components/Modal'

type Category = 'all' | 'credit' | 'reservation_release'
type StatusFilter = 'pending' | 'approved' | 'rejected'

const CATEGORY_LABEL: Record<Category, string> = {
  all: 'All',
  credit: 'Credit',
  reservation_release: 'e-Bike Reservation Release',
}

function categoryOf(a: Approval): Exclude<Category, 'all'> {
  return a.type === 'reservation_release' ? 'reservation_release' : 'credit'
}

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

function statusPill(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  }
  return (
    <span className={'inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium capitalize ' + (styles[status] || styles.pending)}>
      {status}
    </span>
  )
}

/** Human-readable lines describing what is being approved. */
function detailRows(a: Approval): [string, string][] {
  const p = (a.payload || {}) as Record<string, unknown>
  if (a.type === 'reservation_release') {
    const rows: [string, string][] = [
      ['Vehicle', `${p.model || '—'} (VIN ${p.vin || '—'})`],
      ['Customer', String(p.customer_name || '—')],
    ]
    if (p.balance != null) rows.push(['Outstanding balance', ugx(Number(p.balance))])
    if (p.total_price != null) rows.push(['Reservation total', ugx(Number(p.total_price))])
    if (p.note) rows.push(['Reason given', String(p.note)])
    return rows
  }
  const rows: [string, string][] = []
  if (p.receipt_no) rows.push(['Receipt', String(p.receipt_no)])
  if (p.subtotal != null) rows.push(['Subtotal', ugx(Number(p.subtotal))])
  if (p.pct != null) rows.push(['Discount', `${p.pct}%`])
  if (p.discount != null) rows.push(['Discount amount', ugx(Number(p.discount))])
  if (p.total != null) rows.push(['Credit total', ugx(Number(p.total))])
  if (p.note) rows.push(['Note', String(p.note)])
  if (rows.length === 0) rows.push(['Details', JSON.stringify(p)])
  return rows
}

export default function ApprovalsPage() {
  const [category, setCategory] = useState<Category>('credit')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')

  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [detail, setDetail] = useState<Approval | null>(null)
    const [error, setError] = useState('')

  const [page, setPage] = useState(1)
  const pageSize = usePageSize()

  const load = useCallback(async () => {
    const r = await api.approvals('all')
    setApprovals(r.approvals)
  }, [])

  useEffect(() => {
    setPage(1)
    load().catch(() => setApprovals([]))
  }, [load, category, statusFilter])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusyId(id)
    setError('')
    try {
      await api.decideApproval(id, decision)
      setDetail(null)
      setMenuFor(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed')
    } finally {
      setBusyId(null)
    }
  }

  /** Pending counts per category — power the badges on the category buttons. */
  const pending = useMemo(() => (approvals || []).filter((a) => a.status === 'pending'), [approvals])
  const counts = useMemo(() => {
        const c: Record<Exclude<Category, 'all'>, number> = { credit: 0, reservation_release: 0 }
    for (const a of pending) c[categoryOf(a)] += 1
    return c
  }, [pending])

  /** Per-status counts within the current category — one badge per status button. */
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0 }
    for (const a of approvals || []) {
      if (categoryOf(a) !== category) continue
      if (a.status === 'pending') c.pending += 1
      else if (a.status === 'approved') c.approved += 1
      else if (a.status === 'rejected') c.rejected += 1
    }
    return c
  }, [approvals, category])

  const shown = useMemo(
    () =>
      (approvals || []).filter(
        (a) => categoryOf(a) === category && a.status === statusFilter,
      ),
    [approvals, category, statusFilter],
  )

  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = shown.slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeFrom = shown.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const rangeTo = Math.min(safePage * pageSize, shown.length)

  function payloadText(a: Approval): string {
    const p = a.payload || {}
    if (a.type === 'reservation_release') {
      return `Release ${p.model || 'e-bike'} (VIN ${p.vin || '—'}) for ${p.customer_name || 'customer'}`
    }
    const bits: string[] = []
    if (p.receipt_no) bits.push(`Receipt ${p.receipt_no}`)
    if (p.pct) bits.push(`${p.pct}% discount`)
    if (p.discount) bits.push(`${ugx(Number(p.discount))} on ${ugx(Number(p.subtotal))}`)
    if (p.total) bits.push(`Credit of ${ugx(Number(p.total))}`)
    return bits.join(' · ') || JSON.stringify(p)
  }

    const categories: { key: Category; badge: number }[] = [
    { key: 'credit', badge: counts.credit },
    { key: 'reservation_release', badge: counts.reservation_release },
  ]

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Credit sales and e-bike reservation releases waiting on your decision" />
      {error && <div className="mb-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      {/* Category filter buttons with pending-count badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {categories.map(({ key, badge }) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={(category === key ? 'btn-primary' : 'btn-ghost') + ' text-xs relative'}
          >
            {CATEGORY_LABEL[key]}
            {badge > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-900 bg-amber-500 ring-amber-900">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Status filter — applies to whichever category is selected */}
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={(statusFilter === key ? 'btn-primary' : 'btn-ghost') + ' text-xs relative'}
          >
            {label}
            {key === 'pending' && statusCounts.pending > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-900 bg-amber-500 ring-amber-900">
                {statusCounts.pending > 99 ? '99+' : statusCounts.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden relative">
        {approvals === null ? (
          <Spinner />
        ) : shown.length === 0 ? (
                              <EmptyState message={`No ${statusFilter} ${CATEGORY_LABEL[category]} approvals.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Request</th>
                  <th className="th col-opt">Requested by</th>
                  <th className="th col-opt">When</th>
                  <th className="th">Status</th>
                  <th className="th text-right">⋮</th>
                </tr>
              </thead>
            <tbody>
              {pageItems.map((a) => (
                <tr
                  key={a.id}
                  className={'cursor-pointer hover:bg-slate-800/50 transition-colors' + (a.status === 'pending' ? ' bg-orange-500/10' : '')}
                  onClick={() => setDetail(a)}
                >
                  <td className="td text-slate-300">{payloadText(a)}</td>
                  <td className="td col-opt text-slate-400">{a.requested_by_name || '—'}</td>
                  <td className="td col-opt text-xs text-slate-500">{dateTime(a.created_at)}</td>
                  <td className="td whitespace-nowrap">
                    {statusPill(a.status)}
                    <span className="sm:hidden text-slate-600 ml-2 text-xs">›</span>
                  </td>
                  <td className="td text-right relative whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="p-1.5 rounded-md hover:bg-slate-700/60 text-slate-400 hover:text-slate-200"
                      disabled={busyId === a.id}
                      title="Actions"
                      onClick={() => setMenuFor(menuFor === a.id ? null : a.id)}
                    >
                      ⋮
                    </button>
                    {menuFor === a.id && a.status === 'pending' && (
                      <div
                        className="absolute right-2 top-8 z-20 w-40 rounded-lg border border-slate-700 bg-slate-800 shadow-xl py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700/70 disabled:opacity-50"
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-slate-700/70 disabled:opacity-50"
                          disabled={busyId === a.id}
                          onClick={() => decide(a.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
                            </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination — outside the card so it sits below it */}
      {approvals && shown.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-slate-500">Showing {rangeFrom}–{rangeTo} of {shown.length}</span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <span className="text-slate-400 text-xs">Page {safePage} of {totalPages}</span>
            <button className="btn-ghost text-xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        </div>
      )}

      {/* Detail dialog — full transaction context, with Approve / Reject actions */}
      {detail && (
        <Modal title={`Approval — ${CATEGORY_LABEL[categoryOf(detail)]}`} onClose={() => setDetail(null)}>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {statusPill(detail.status)}
              <span className="text-xs text-slate-500">
                Requested by {detail.requested_by_name || '—'} · {dateTime(detail.created_at)}
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 divide-y divide-slate-800">
              {detailRows(detail).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-3 py-2 text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-slate-200 text-right">{value}</span>
                </div>
              ))}
            </div>

            {detail.status !== 'pending' && (
              <div className="text-xs text-slate-500">
                {detail.status === 'approved' ? 'Approved' : 'Rejected'}
                {detail.decided_by_name ? ` by ${detail.decided_by_name}` : ''}
                {detail.decided_at ? ` · ${dateTime(detail.decided_at)}` : ''}
              </div>
            )}

            {detail.status === 'pending' && (
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="btn-ghost text-sm"
                  disabled={busyId === detail.id}
                  onClick={() => decide(detail.id, 'rejected')}
                >
                  Reject
                </button>
                <button
                  className="btn-primary text-sm"
                  disabled={busyId === detail.id}
                  onClick={() => decide(detail.id, 'approved')}
                >
                  Approve
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
