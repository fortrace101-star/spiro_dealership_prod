import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, timeAgo } from '../lib/format'
import type { AuditEntry } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'

const ACTION_TONES: Record<string, string> = {
  create_product: 'approved',
  update_product: 'pending',
  create_bike: 'approved',
  update_bike: 'pending',
  stock_adjustment: 'credit',
  approval_approved: 'approved',
  approval_rejected: 'rejected',
  register: 'approved',
  login: '',
}

/** Pretty-prints an audit value blob for the detail drawer (falls back to a dash). */
function prettyValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  // Row detail drawer: on phones the Entity + Changes columns are hidden, so
  // tapping a row is how a cashier/admin reads the full entry (matches Customers).
  const [detail, setDetail] = useState<AuditEntry | null>(null)

  useEffect(() => {
    api
      .audit()
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]))
  }, [])

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="User + date + time + old value + new value for every critical action" />

      <div className="card overflow-hidden">
        {entries === null ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <EmptyState message="No audit entries yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">When</th>
                  <th className="th">User</th>
                  <th className="th">Action</th>
                  <th className="th col-opt">Entity</th>
                  <th className="th col-opt">Changes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className="hover:bg-slate-800/30 cursor-pointer transition"
                    onClick={() => setDetail(e)}
                  >
                    <td className="td text-xs text-slate-500 whitespace-nowrap">
                      {/* Compact on phones (matches the Customers lifetime-value pattern) so the
                          row fits one line; the drawer shows the exact timestamp. */}
                      <span className="sm:hidden">{timeAgo(e.created_at)}</span>
                      <span className="hidden sm:inline">{dateTime(e.created_at)}</span>
                    </td>
                    <td className="td">
                      <div className="text-sm font-medium text-white">{e.user_name || 'System'}</div>
                      <div className="text-[11px] text-slate-500 capitalize">{e.user_role || ''}</div>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <Badge kind={ACTION_TONES[e.action]}>{e.action.replace(/_/g, ' ')}</Badge>
                        {/* Phones hide Entity/Changes, so the row advertises the tap-through. */}
                        <span className="sm:hidden text-slate-600 text-xs">›</span>
                      </div>
                    </td>
                    <td className="td col-opt text-xs text-slate-400 font-mono">{e.entity}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ''}</td>
                    <td className="td col-opt text-xs text-slate-500 max-w-md truncate">
                      {e.old_value ? `old: ${JSON.stringify(e.old_value)}` : ''}
                      {e.old_value && e.new_value ? ' → ' : ''}
                      {e.new_value ? `new: ${JSON.stringify(e.new_value)}` : ''}
                      {!e.old_value && !e.new_value && e.meta ? JSON.stringify(e.meta) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Row detail drawer: the mobile view of an entry — Entity + Changes in full. */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-lg h-full bg-[#12161d] border-l border-slate-800 p-4 sm:p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5 gap-4">
              <div className="min-w-0">
                <div className="text-lg font-bold text-white capitalize">{(detail.action || '').replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-500 mt-0.5">{dateTime(detail.created_at)}</div>
              </div>
              <button className="btn-ghost text-xs shrink-0" onClick={() => setDetail(null)}>Close</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">User</div>
                <div className="text-sm font-semibold text-white mt-0.5">{detail.user_name || 'System'}</div>
                <div className="text-[11px] text-slate-500 capitalize">{detail.user_role || '—'}</div>
              </div>
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Entity</div>
                <div className="text-sm font-semibold text-white mt-0.5">{detail.entity || '—'}</div>
                <div className="text-[11px] font-mono text-slate-500 break-all">{detail.entity_id || '—'}</div>
              </div>
            </div>

            <h4 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Changes</h4>
            <div className="space-y-2">
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Old value</div>
                <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono">{prettyValue(detail.old_value)}</pre>
              </div>
              <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">New value</div>
                <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono">{prettyValue(detail.new_value)}</pre>
              </div>
              {detail.meta ? (
                <div className="bg-[#0b0e13] rounded-xl p-3 border border-slate-800/60">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Meta</div>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono">{prettyValue(detail.meta)}</pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
