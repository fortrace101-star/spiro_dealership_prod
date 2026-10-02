import { useState } from 'react'
import { api } from '../lib/api'
import type { ServiceJobCard } from '../lib/types'
import { Modal } from './Modal'

type Props = {
  onClose: () => void
  onCreated: () => void
}

const PRIORITY = ['low', 'normal', 'high', 'urgent'] as const
const PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

/**
 * Minimal job-card creator for the dispatch page. An issue + priority is
 * enough to spin up a card that can then be assigned; full bike/customer
 * linking is a later task so those fields are intentionally optional here.
 */
export default function NewJobModal({ onClose, onCreated }: Props) {
  const [issue, setIssue] = useState('')
  const [priority, setPriority] = useState<(typeof PRIORITY)[number]>('normal')
  const [mileage, setMileage] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!issue.trim()) return setError('Issue is required')
    setSaving(true)
    setError('')
    try {
      await api.createJob({
        issue: issue.trim(),
        priority,
        mileage_km: Number(mileage) || 0,
      })
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create job')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New job card" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Issue / description *</label>
          <input
            className="input w-full"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="e.g. Battery not holding charge"
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Priority</label>
            <select
              className="input w-full"
              value={priority}
              onChange={(e) => setPriority(e.target.value as (typeof PRIORITY)[number])}
            >
              {PRIORITY.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Mileage (km)</label>
            <input
              className="input w-full"
              type="number"
              min={0}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create job card'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
