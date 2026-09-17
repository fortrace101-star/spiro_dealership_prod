import { useState } from 'react'
import { customPeriod, PERIODS } from '../lib/periods'
import type { Period } from '../lib/periods'
import { Field } from '../pages/InventoryPage'

/**
 * Shared period selector: named presets (Today → This year) + Custom.
 * Custom opens an inline panel with a day count or explicit from/to dates.
 */
export function PeriodPicker({
  period,
  onChange,
}: {
  period: Period
  onChange: (p: Period) => void
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChange(p)
              setShowCustom(false)
            }}
            className={period.id === p.id && !showCustom ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
          >
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => setShowCustom(true)} className={showCustom ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="card p-4 mt-3 grid gap-3 sm:flex sm:flex-wrap sm:items-end">
          <Field label="Last N days (max 730)">
            <input
              className="input sm:max-w-[140px]"
              type="number"
              min={1}
              max={730}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              placeholder="e.g. 45"
            />
          </Field>
          <span className="text-xs text-slate-500 sm:pb-2.5">or</span>
          <Field label="From">
            <input className="input sm:max-w-[160px]" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input sm:max-w-[160px]" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </Field>
          <button
            type="button"
            className="btn-primary text-xs w-full sm:w-auto"
            onClick={() => onChange(customPeriod(customDays ? Number(customDays) : undefined, customFrom || undefined, customTo || undefined))}
          >
            Apply
          </button>
          {period.id === 'custom' && <span className="text-xs text-brand-300 sm:pb-2.5">Active: {period.label}</span>}
        </div>
      )}
    </div>
  )
}
