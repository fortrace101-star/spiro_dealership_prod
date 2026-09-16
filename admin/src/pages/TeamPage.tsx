import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, timeAgo } from '../lib/format'
import type { ActivationCode, User } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

export default function TeamPage() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [codes, setCodes] = useState<ActivationCode[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ label: '', role: 'cashier', days: '7' })
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const [u, c] = await Promise.all([api.staff(), api.codes()])
    setUsers(u.users)
    setCodes(c.codes)
  }, [])

  useEffect(() => {
    load().catch(() => {
      setUsers([])
      setCodes([])
    })
  }, [load])

  async function createCode(e: React.FormEvent) {
    e.preventDefault()
    const r = await api.createCode(form.label, form.role, Number(form.days) || 7)
    setLastCode(r.code.code)
    setCopied(false)
    setShowForm(false)
    load()
  }

  async function toggleUser(u: User) {
    await api.updateUser(u.id, { is_active: !u.is_active })
    load()
  }

  function copy(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div>
      <PageHeader
        title="Team & Activation Codes"
        subtitle="POS operators register themselves with a code you generate"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Generate code</button>}
      />

      {lastCode && (
        <div className="card p-5 mb-4 border-brand-500/40 bg-brand-500/5">
          <div className="text-xs uppercase tracking-wider text-brand-300 font-semibold mb-2">New activation code</div>
          <div className="flex items-center gap-3">
            <code className="text-2xl font-mono font-bold text-white tracking-wider">{lastCode}</code>
            <button className="btn-ghost text-xs" onClick={() => copy(lastCode)}>{copied ? '✓ Copied' : 'Copy'}</button>
            <button className="btn-ghost text-xs" onClick={() => setLastCode(null)}>Dismiss</button>
          </div>
          <p className="text-xs text-slate-500 mt-2">Share this with the operator. They enter it on the POS login screen together with their name and a password.</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Staff */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/70">
            <h3 className="font-semibold text-white">Staff accounts</h3>
          </div>
          {users === null ? (
            <Spinner />
          ) : users.length === 0 ? (
            <EmptyState message="No staff yet." />
          ) : (
            <table className="w-full">
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="td">
                      <div className="font-medium text-white">{u.full_name}</div>
                      <div className="text-xs text-slate-500">{u.email || 'no email'}</div>
                    </td>
                    <td className="td"><Badge>{u.role}</Badge></td>
                    <td className="td text-xs text-slate-500">{u.last_login_at ? `Active ${timeAgo(u.last_login_at)}` : 'Never logged in'}</td>
                    <td className="td text-right">
                      {u.role !== 'admin' && (
                        <button className={u.is_active ? 'btn-danger text-xs px-2 py-1' : 'btn-ghost text-xs px-2 py-1'} onClick={() => toggleUser(u)}>
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Codes */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/70">
            <h3 className="font-semibold text-white">Activation codes</h3>
          </div>
          {codes === null ? (
            <Spinner />
          ) : codes.length === 0 ? (
            <EmptyState message="No codes generated yet." />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Role</th>
                  <th className="th">Status</th>
                  <th className="th">Expires</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id}>
                    <td className="td">
                      <button className="font-mono text-xs text-brand-300 hover:underline" onClick={() => copy(c.code)} title="Click to copy">
                        {c.code}
                      </button>
                      {c.label && <div className="text-[11px] text-slate-500">{c.label}</div>}
                    </td>
                    <td className="td"><Badge>{c.role}</Badge></td>
                    <td className="td">
                      {c.used_at ? (
                        <span className="text-xs text-slate-500">Used by {c.claimed_by_name || '—'}</span>
                      ) : new Date(c.expires_at) < new Date() ? (
                        <Badge kind="rejected">Expired</Badge>
                      ) : (
                        <Badge kind="approved">Active</Badge>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">{dateTime(c.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title="Generate activation code" onClose={() => setShowForm(false)}>
          <form onSubmit={createCode} className="space-y-3">
            <Field label="Label (e.g. Kampala Road counter)"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="cashier">Cashier (POS)</option>
                  <option value="manager">Manager</option>
                  <option value="mechanic">Mechanic</option>
                </select>
              </Field>
              <Field label="Valid for (days)"><input className="input" type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary">Generate</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
