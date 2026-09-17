import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, ugx } from '../lib/format'
import type { Approval } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'

export default function ApprovalsPage() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [approvals, setApprovals] = useState<Approval[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api.approvals(status)
    setApprovals(r.approvals)
  }, [status])

  useEffect(() => {
    load().catch(() => setApprovals([]))
  }, [load])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusyId(id)
    try {
      await api.decideApproval(id, decision)
      load()
    } finally {
      setBusyId(null)
    }
  }

  function payloadText(a: Approval): string {
    const p = a.payload || {}
    const bits: string[] = []
    if (p.receipt_no) bits.push(`Receipt ${p.receipt_no}`)
    if (p.pct) bits.push(`${p.pct}% discount`)
    if (p.discount) bits.push(`${ugx(p.discount as number)} on ${ugx(p.subtotal as number)}`)
    if (p.total) bits.push(`Credit of ${ugx(p.total as number)}`)
    return bits.join(' · ') || JSON.stringify(p)
  }

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Discount, credit and stock-adjustment requests from the floor" />

      <div className="flex flex-wrap gap-2 mb-4">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={status === s ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
          >
            <span className="capitalize">{s}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {approvals === null ? (
          <Spinner />
        ) : approvals.length === 0 ? (
          <EmptyState message={`No ${status} approvals.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Type</th>
                  <th className="th">Request</th>
                  <th className="th">Requested by</th>
                  <th className="th">When</th>
                  <th className="th"></th>
                </tr>
              </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td className="td"><Badge kind={a.type === 'credit_sale' ? 'credit' : 'pending'}>{a.type.replace('_', ' ')}</Badge></td>
                  <td className="td text-slate-300">{payloadText(a)}</td>
                  <td className="td text-slate-400">{a.requested_by_name || '—'}</td>
                  <td className="td text-xs text-slate-500">{dateTime(a.created_at)}</td>
                  <td className="td text-right whitespace-nowrap">
                    {a.status === 'pending' ? (
                      <>
                        <button className="btn-primary text-xs px-3 py-1.5" disabled={busyId === a.id} onClick={() => decide(a.id, 'approved')}>Approve</button>
                        <button className="btn-danger text-xs px-3 py-1.5 ml-2" disabled={busyId === a.id} onClick={() => decide(a.id, 'rejected')}>Reject</button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {a.decided_by_name || ''} · {a.decided_at ? dateTime(a.decided_at) : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
