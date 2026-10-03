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
  const [filters, setFilters] = useState({ action: '', user: '', from: '', to: '' })
  // Row detail drawer: on phones the Entity + Changes columns are hidden, so
  // tapping a row is how a cashier/admin reads the full entry (matches Customers).
  const [detail, setDetail] = useState<AuditEntry | null>(null)

    useEffect(() => {
    const params: { action?: string; user?: string; from?: string; to?: string } = {}
    if (filters.action) params.action = filters.action
    if (filters.user) params.user = filters.user
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    api
      .audit(params)
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]))
  }, [filters.action, filters.user, filters.from, filters.to])

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="User + date + time + old value + new value for every critical action" />

      {/* Audit filters — date range, event-type dropdown, actor. The server
          applies the same filters on its side, so scoping is authoritative and
          paging/categorising never holds rows the API can't return. */}
      <div className="card p-3 sm:p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">From</label>
          <input type="date" className="input mt-1 w-full" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">To</label>
          <input type="date" className="input mt-1 w-full" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Event type</label>
          <select className="input mt-1 w-full" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">All events</option>
            <optgroup label="Inventory">
              <option value="stock_adjustment">Stock adjustment</option>
              <option value="update_product">Product edited</option>
              <option value="create_product">Product created</option>
              <option value="delete_product">Product deleted</option>
            </optgroup>
            <optgroup label="Sales">
              <option value="sale">Sale</option>
              <option value="payment">Payment</option>
            </optgroup>
            <optgroup label="Finance">
              <option value="installment_received">Installment received</option>
              <option value="credit_approval">Credit approval</option>
              <option value="credit_decision">Credit decision</option>
            </optgroup>
            <optgroup label="Reservations">
              <option value="reservation_release_requested">Release requested</option>
            </optgroup>
            <optgroup label="Customers">
              <option value="create_customer">Customer created</option>
              <option value="update_customer">Customer updated</option>
            </optgroup>
            <optgroup label="Team">
              <option value="approval_approved">Approval approved</option>
              <option value="approval_rejected">Approval rejected</option>
              <option value="register">Register / login</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
            </optgroup>
            <optgroup label="Purchasing">
              <option value="reorder_list">Reorder list</option>
              <option value="restock">Restock</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Actor</label>
          <input type="text" className="input mt-1 w-full" placeholder="name or user id" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} />
        </div>
      </div>
      {Object.values(filters).some(Boolean) && (
        <div className="mb-3">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setFilters({ action: '', user: '', from: '', to: '' })}>Clear filters</button>
        </div>
      )}
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
