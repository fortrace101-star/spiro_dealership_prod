import { useState } from 'react'
import { api } from '../lib/api'
import { PageHeader } from '../components/ui'
import { Field } from './InventoryPage'

/**
 * Settings currently hosts the account-security form. Period reports live on
 * Overview (filterable from its period dropdown) and staff performance on the
 * "Team & Activation Codes" page — this page keeps the nav route stable and
 * gives the administrator a place to change their own password.
 */
export default function SettingsPage() {
  const [pwForm, setPwForm] = useState({ current: '', next: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function changePw(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg('')
    setPwBusy(true)
    try {
      await api.changePassword(pwForm.current, pwForm.next)
      setPwMsg('✓ Password updated')
      setPwForm({ current: '', next: '' })
    } catch (err) {
      setPwMsg(err instanceof Error ? err.message : 'Failed')
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account security" />

      <div className="card p-5 max-w-md">
        <h3 className="font-semibold text-white mb-4">Change password</h3>
        <form onSubmit={changePw} className="space-y-3">
          <Field label="Current password">
            <input
              className="input"
              type="password"
              value={pwForm.current}
              onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
              required
            />
          </Field>
          <Field label="New password (min 6 chars)">
            <input
              className="input"
              type="password"
              value={pwForm.next}
              onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
              required
              minLength={6}
            />
          </Field>
          {pwMsg && <p className="text-sm text-brand-300">{pwMsg}</p>}
          <button className="btn-primary" disabled={pwBusy}>
            {pwBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
