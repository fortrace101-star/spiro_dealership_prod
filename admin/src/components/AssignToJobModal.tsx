import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ServiceJobCard, User } from '../lib/types'
import { Modal } from './Modal'
import { Spinner } from './ui'

type Props = {
  job: ServiceJobCard
  onClose: () => void
  onAssigned: () => void
}

/**
 * "Assign to Job" modal — the dispatch page opens this for a job card.
 * It lists every active staff member (mechanic/operator) so the manager
 * can assign them to the card. The selection is sent to the server as the
 * user's id; the server resolves the display name and flips an assigned
 * 'pending' card to 'in_progress'.
 */
export default function AssignToJobModal({ job, onClose, onAssigned }: Props) {
  const [employees, setEmployees] = useState<User[]>([])
  const [selected, setSelected] = useState<string>(job.assigned_to || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const { users } = await api.staff()
        if (!dead) setEmployees(users)
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : 'Could not load staff')
      } finally {
        if (!dead) setLoading(false)
      }
    })()
  }, [])

  const active = employees.filter((u) => u.is_active)

  async function save() {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      await api.assignJob(job.id, selected)
      onAssigned()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Assign to job" wide onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="text-xs text-slate-400 uppercase">Issue</div>
          <div className="text-sm text-white">{job.issue || '—'}</div>
        </div>
        {job.assigned_to_name && (
          <div className="text-xs text-slate-400">
            Currently assigned: {job.assigned_to_name}
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-1">
            <label className="block text-xs text-slate-400 mb-1">Assign to a registered employee</label>
            <select
              className="input w-full"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Employee to assign"
            >
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} — {u.role}
                </option>
              ))}
              {active.length === 0 && (
                <option value="" disabled>
                  No active employees
                </option>
              )}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || loading || !selected || active.length === 0}
          >
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
