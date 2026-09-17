import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, timeAgo } from '../lib/format'
import type { ActivationCode, PosPermission, User } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { Field, Modal } from './InventoryPage'

/** Extra POS capabilities offered on the code form (server whitelists these too) */
const PERM_OPTIONS: { id: PosPermission; label: string; hint: string }[] = [
  { id: 'inventory_entry', label: 'Inventory entry', hint: 'Add / edit products and adjust stock on the POS' },
]

export default function TeamPage() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [codes, setCodes] = useState<ActivationCode[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ label: '', role: 'cashier', days: '7', permissions: [] as PosPermission[] })
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [lastCodePerms, setLastCodePerms] = useState<PosPermission[]>([])
  const [copied, setCopied] = useState(false)
  const [permBusyId, setPermBusyId] = useState<string | null>(null)

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
    const r = await api.createCode(form.label, form.role, Number(form.days) || 7, form.permissions)
    setLastCode(r.code.code)
    setLastCodePerms(r.code.permissions || [])
    setCopied(false)
    setShowForm(false)
    setForm({ label: '', role: 'cashier', days: '7', permissions: [] })
    load()
  }

  function togglePerm(p: PosPermission) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p],
    }))
  }

  async function toggleUser(u: User) {
    await api.updateUser(u.id, { is_active: !u.is_active })
    load()
  }

  /** Grant or revoke POS inventory entry for an already-registered operator. */
  async function toggleInventoryEntry(u: User) {
    const has = (u.permissions || []).includes('inventory_entry')
    setPermBusyId(u.id)
    try {
      await api.updateUser(u.id, { permissions: has ? [] : ['inventory_entry'] })
      await load()
    } finally {
      setPermBusyId(null)
    }
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
        subtitle="Operators register with a code you generate; grant inventory entry to anyone already on the team"
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
          {lastCodePerms.length > 0 && (
            <p className="text-xs text-sky-300 mt-1">
              Includes: {lastCodePerms.map((p) => p.replace('_', ' ')).join(', ')}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-2">Share this with the operator. They enter it on the POS login screen together with their name, email and a password.</p>
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
                    <td className="td">
                      {u.role === 'admin' || u.role === 'manager' ? (
                        <span className="text-[11px] text-slate-500">All POS capabilities</span>
                      ) : (
                        <button
                          className={(u.permissions || []).includes('inventory_entry')
                            ? 'text-[11px] px-2 py-1 rounded-md border border-sky-500/30 bg-sky-500/15 text-sky-300'
                            : 'btn-ghost text-xs px-2 py-1'}
                          disabled={permBusyId === u.id}
                          onClick={() => toggleInventoryEntry(u)}
                          title="Let this operator add products and receive stock on the POS"
                        >
                          {(u.permissions || []).includes('inventory_entry') ? '✓ Inventory entry' : '+ Inventory entry'}
                        </button>
                      )}
                    </td>
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
                    <td className="td">
                      <Badge>{c.role}</Badge>
                      {(c.permissions?.length ?? 0) > 0 && (
                        <div className="mt-1">
                          {c.permissions!.map((p) => (
                            <span key={p} className="inline-block text-[10px] px-1.5 py-0.5 mr-1 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/20">
                              {p.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
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
            <Field label="Extra POS permissions (what this user can do beyond their role)">
              <div className="space-y-2">
                {PERM_OPTIONS.map((p) => (
                  <label key={p.id} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-800/70 hover:border-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-brand-500 mt-0.5"
                      checked={form.permissions.includes(p.id)}
                      onChange={() => togglePerm(p.id)}
                    />
                    <span>
                      <span className="text-sm text-slate-200 font-medium">{p.label}</span>
                      <span className="block text-xs text-slate-500">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
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
