import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
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

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)

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
                  <th className="th">Entity</th>
                  <th className="th">Changes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="td text-xs text-slate-500 whitespace-nowrap">{dateTime(e.created_at)}</td>
                    <td className="td">
                      <div className="text-sm text-white">{e.user_name || 'System'}</div>
                      <div className="text-[11px] text-slate-500 capitalize">{e.user_role || ''}</div>
      </td>
                    <td className="td"><Badge kind={ACTION_TONES[e.action]}>{e.action.replace(/_/g, ' ')}</Badge></td>
                    <td className="td text-xs text-slate-400 font-mono">{e.entity}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ''}</td>
                    <td className="td text-xs text-slate-500 max-w-md truncate">
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
    </div>
  )
}
