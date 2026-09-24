 import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { dateTime, timeAgo } from '../lib/format'
import type { ActivationCode, PosPermission, User } from '../lib/types'
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui'
import { cn } from '../lib/cn'
import { Field, Modal } from './InventoryPage'

/**
 * Grantable POS capabilities, grouped like the server catalog
 * (`GET /api/admin/permissions`, `server/src/permissions/catalog.js`). Ticking
 * one lets an operator do manager-only work without making them a manager; the
 * server whitelists exactly these ids. Selling and credit requests are the
 * operator baseline (shown locked / always on), finalizing and settling credit
 * sales are manager-by-default and tickable per person, and discounts are
 * admin-only (never grantable).
 */
const PERM_GROUPS: { group: string; options: { id: PosPermission; label: string; hint: string; baseline?: boolean }[] }[] = [
  {
    group: 'Credit',
    options: [
      { id: 'credit_request', label: 'Send credit-sale requests', hint: 'Always on for every POS role — a request always waits for admin approval', baseline: true },
      { id: 'credit_finalize', label: 'Finalize approved credit sales', hint: 'Deduct stock and open the debt — manager by default' },
      { id: 'credit_settle', label: 'Record credit settlements', hint: 'Money-in against an outstanding credit debt — manager by default' },
      { id: 'installment_collect', label: 'Record reservation installments', hint: 'Money-in against an active bike reservation' },
    ],
  },
  {
    group: 'Reservations',
    options: [
      { id: 'reservation_create', label: 'Create reservations', hint: 'Take a down payment and lock the bike VIN' },
      { id: 'reservation_complete', label: 'Complete reservations', hint: 'Turn a fully paid reservation into a sale' },
      { id: 'reservation_release', label: 'Release reservations', hint: 'Bike returns to stock — still needs an admin approval' },
    ],
  },
  {
    group: 'Stock',
    options: [
      { id: 'inventory_receive', label: 'Receive stock', hint: 'Record consignments, create new SKUs and start a standalone restock — the whole receive flow' },
      { id: 'reorder_create', label: 'Create reorder lists', hint: 'Draft what to order next — never changes stock' },
      { id: 'reorder_manage', label: 'Manage reorder lists', hint: 'Mark a list processed / fulfilled / cancelled' },
    ],
  },
]

const PERM_OPTIONS = PERM_GROUPS.flatMap((g) => g.options)
/** Human label for a stored grant (legacy ids fall back to a de-underscored id). */
const PERM_LABELS = new Map<string, string>(PERM_OPTIONS.map((p) => [p.id, p.label]))

/** Values stored before the catalog existed, expanded like the server does. */
const LEGACY_EXPANSIONS: Partial<Record<string, PosPermission[]>> = {
  inventory_entry: ['inventory_receive', 'reorder_manage'],
}

/**
 * Stored grants with legacy aliases expanded, de-duplicated and filtered to the
 * ids the UI actually renders — so an old `inventory_entry` row still shows its
 * stock checkboxes as ticked, while ids folded into another capability (e.g.
 * `product_create`, now part of receiving) disappear instead of lingering.
 */
function visibleGrants(perms?: PosPermission[]): PosPermission[] {
  return [...new Set(expandGrants(perms))].filter((p) => PERM_LABELS.has(p))
}
function expandGrants(perms?: PosPermission[]): PosPermission[] {
  return (perms ?? []).flatMap((p) => LEGACY_EXPANSIONS[p] ?? [p])
}

export default function TeamPage() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [codes, setCodes] = useState<ActivationCode[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ label: '', role: 'operator', days: '7', permissions: [] as PosPermission[] })
  const [lastCode, setLastCode] = useState<string | null>(null)
  const [lastCodePerms, setLastCodePerms] = useState<PosPermission[]>([])
  const [copied, setCopied] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [permBusyId, setPermBusyId] = useState<string | null>(null)
  const [staffDetail, setStaffDetail] = useState<User | null>(null)

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
    setForm({ label: '', role: 'operator', days: '7', permissions: [] })
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

  /**
   * Grant or revoke one POS capability for a team member. The server reloads the
   * user on every request, so the POS picks the change up without a re-login.
   */
  async function toggleStaffPerm(u: User, id: PosPermission) {
    // Expand legacy aliases first: the server rewrites them to their modern
    // ids anyway, so ticking one stock box on an old `inventory_entry` row
    // cleanly replaces the alias instead of piling grants on top of it.
    const perms = expandGrants(u.permissions)
    const next = perms.includes(id) ? perms.filter((x) => x !== id) : [...perms, id]
    setPermBusyId(u.id)
    try {
      await updateStaffPerms(u, next)
    } finally {
      setPermBusyId(null)
    }
  }

  function copy(code: string, id?: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setCopiedId(id ?? null)
      setTimeout(() => {
        setCopied(false)
        setCopiedId(null)
      }, 1500)
    })
  }

  function openStaff(u: User) {
    setStaffDetail(u)
  }

  async function updateStaffPerms(u: User, perms: PosPermission[]) {
    await api.updateUser(u.id, { permissions: perms })
    setStaffDetail((prev) => (prev && prev.id === u.id ? { ...prev, permissions: perms } : prev))
    load()
  }

  async function updateStaffActive(u: User, active: boolean) {
    await api.updateUser(u.id, { is_active: active })
    setStaffDetail((prev) => (prev && prev.id === u.id ? { ...prev, is_active: active } : prev))
    load()
  }

  return (
    <div>
      <PageHeader
        title="Team & Activation Codes"
        subtitle="Operators register with a code you generate; elevate a trusted operator's rights from their card — no promotion needed"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}>+ Generate code</button>}
      />

      {lastCode && (
        <div className="card p-5 mb-4 border-brand-500/40 bg-brand-500/5">
          <div className="text-xs uppercase tracking-wider text-brand-300 font-semibold mb-2">New activation code</div>
          <div className="flex flex-wrap items-center gap-3">
            <code className="text-xl sm:text-2xl font-mono font-bold text-white tracking-wider break-all">{lastCode}</code>
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Staff</th>
                    <th className="th col-opt">Last seen</th>
                    <th className="th">Privileges</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                                        <tr
                      key={u.id}
                      onClick={() => openStaff(u)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        u.role === 'admin'
                          ? 'hover:bg-sky-950/30'
                          : 'hover:bg-slate-800/30',
                      )}
                    >
                      <td className="td">
                        <div className="font-medium text-white">{u.full_name}</div>
                        <div className="text-xs text-slate-500">{u.email || "no email"}</div>
                                                                        <div className="mt-1.5">
                          <Badge kind={u.role === 'admin' ? 'pending' : undefined}>
                            {u.role === 'admin' ? 'Administrator' : u.role}
                          </Badge>
                        </div>
                      </td>
                      <td className="td col-opt text-xs text-slate-500">{u.last_login_at ? `Active ${timeAgo(u.last_login_at)}` : "Never logged in"}</td>
                                            <td className="td">
                        <div className="flex flex-wrap gap-1 items-center">
                          {u.role === 'admin' && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/15 text-amber-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Administrator
                            </span>
                          )}
                          {visibleGrants(u.permissions).map((p) => (
                            <span
                              key={p}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-sky-500/30 bg-sky-500/15 text-sky-300"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                              {PERM_LABELS.get(p) ?? p.replace(/_/g, ' ')}
                            </span>
                          ))}
                          {u.role !== 'admin' && visibleGrants(u.permissions).length === 0 && (
                            <span className="text-[11px] text-slate-500">No extra POS rights</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="overflow-x-auto">
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
                          {visibleGrants(c.permissions).map((p) => (
                            <span key={p} className="inline-block text-[10px] px-1.5 py-0.5 mr-1 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/20">
                              {PERM_LABELS.get(p) ?? p.replace(/_/g, ' ')}
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
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title="Generate activation code" onClose={() => setShowForm(false)}>
          <form onSubmit={createCode} className="space-y-3">
            <Field label="Label (e.g. Kampala Road counter)"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Role">
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="operator">Operator (POS)</option>
                  <option value="manager">Manager</option>
                </select>
              </Field>
              <Field label="Valid for (days)"><input className="input" type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
            </div>
            <Field label="Extra POS permissions (what this user can do beyond their role)">
              <div className="space-y-2">
                {PERM_OPTIONS.map((p) => (
                  <label key={p.id} className={cn('flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-800/70', p.baseline ? 'cursor-default' : 'hover:border-slate-700 cursor-pointer')}>
                    <input
                      type="checkbox"
                      className="accent-brand-500 mt-0.5"
                      disabled={p.baseline}
                      checked={p.baseline || form.permissions.includes(p.id)}
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
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost w-full sm:w-auto" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary w-full sm:w-auto">Generate</button>
            </div>
          </form>
        </Modal>
      )}
      {/* Staff management modal */}
      {staffDetail && (
                <Modal title={`Manage — ${staffDetail.full_name}`} onClose={() => setStaffDetail(null)}>
          <div className="space-y-5">
            {/* Staff info card */}
            <div className="bg-[#0b0e13] border border-slate-800/60 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Name</div>
                                  <div className="text-white font-medium">{staffDetail.full_name}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Email</div>
                  <div className="text-white break-words">{staffDetail.email || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Role</div>
                  <div className="text-white">{staffDetail.role ? staffDetail.role.charAt(0).toUpperCase() + staffDetail.role.slice(1).toLowerCase() : '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Status</div>
                  <div className={staffDetail.is_active ? 'text-emerald-300' : 'text-red-300'}>{staffDetail.is_active ? 'Active' : 'Inactive'}</div>
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-3">Last login: {staffDetail.last_login_at ? timeAgo(staffDetail.last_login_at) : 'Never'} · Created: {dateTime(staffDetail.created_at)}</div>
            </div>

            {/* Elevate rights — the grantable catalog, ticked per person */}
            <div className="space-y-3">
              <div className="text-sm font-semibold text-white">Elevate rights</div>
              {staffDetail.role === 'admin' ? (
                <p className="text-xs text-slate-500">Administrators already hold every POS capability — nothing to grant.</p>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    Tick what this member can do beyond their role — the POS picks the change up on their next request, no new code needed.
                  </p>
                  {PERM_GROUPS.map((g) => (
                    <div key={g.group}>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">{g.group}</div>
                      <div className="space-y-2">
                        {g.options.map((p) => (
                          <label key={p.id} className={cn('flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-800/70', p.baseline ? 'cursor-default' : 'hover:border-slate-700 cursor-pointer')}>
                            <input
                              type="checkbox"
                              className="accent-brand-500 mt-0.5"
                              disabled={p.baseline || permBusyId === staffDetail.id}
                              checked={p.baseline || expandGrants(staffDetail.permissions).includes(p.id)}
                              onChange={() => toggleStaffPerm(staffDetail, p.id)}
                            />
                            <span>
                              <span className="text-sm text-slate-200 font-medium">{p.label}</span>
                              <span className="block text-xs text-slate-500">{p.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

                        {staffDetail.role !== 'admin' && (
              <>
                {/* POS access */}
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-white">POS access</div>
                  <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                    <button className="btn-ghost w-full sm:w-auto" disabled={permBusyId === staffDetail.id} onClick={() => updateStaffActive(staffDetail, false)}>Deactivate POS access</button>
                    <button
                      className="btn-primary w-full sm:w-auto"
                      disabled={permBusyId === staffDetail.id}
                      onClick={() => (staffDetail.is_active ? setStaffDetail(null) : updateStaffActive(staffDetail, true))}
                    >
                      {staffDetail.is_active ? 'Close' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
