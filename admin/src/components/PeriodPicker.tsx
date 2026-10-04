import { useState } from 'react'
import { customPeriod, PERIODS } from '../lib/periods'
import type { Period } from '../lib/periods'
import { Field } from '../pages/InventoryPage'
import { useIsPhone } from '../lib/usePageSize'

/**
 * Shared period selector: named presets (Today → This year) + Custom.
 * Custom opens an inline panel with a day count or explicit from/to dates.
 *
 * variant="buttons" (default): preset chips + a Custom chip (Settings page).
 * variant="select": one dropdown holding every preset plus a "Custom…"
 * entry that reveals the same panel (Sales page).
 */
export function PeriodPicker({
  period,
  onChange,
  variant = 'buttons',
  panelClassName = '',
}: {
  period: Period
  onChange: (p: Period) => void
  variant?: 'buttons' | 'select'
    /**
   * Optional classes for the select variant's custom panel. The default panel
   * is an inline (normal-flow) full-width block: it renders below the select and
   * pushes sibling content down, never as an overlay. Pass classes for visual
   * styling only (e.g. bg/border) — the layout always stays inline.
   */
  panelClassName?: string
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // Compact preset text on phones, full text from `sm:` up (Rule 3 style).
  // Called unconditionally: hooks must not sit behind a variant branch.
  const phone = useIsPhone()

  if (variant === 'select') {
    const isCustom = period.id === 'custom'
    const customOpen = showCustom || isCustom
    const optLabel = (p: Period) => (phone ? p.short ?? p.label : p.label)
    return (
      <div>
        <select
          className="input truncate text-[13px] sm:text-sm"
          aria-label="Period"
          value={customOpen ? 'custom' : period.id}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setShowCustom(true)
            } else {
              setShowCustom(false)
              const p = PERIODS.find((x) => x.id === e.target.value)
              if (p) onChange(p)
            }
          }}
        >
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>{optLabel(p)}</option>
          ))}
          {/* The custom entry is never applied directly — selecting it only
              opens the from/to panel below; Apply commits the range. */}
          <option value="custom">{isCustom ? optLabel(period) : 'Custom…'}</option>
        </select>

        {customOpen && (
          /* Inline (normal flow), never an overlay: the panel renders below the
             select at the column's full width and pushes the rows beneath it
             downward instead of floating over them. `panelClassName` adds only
             visual styling (bg/border/shadow) — no absolute positioning, so
             sibling KPI/chart/cashier content is never covered. */
          <div className={`flex flex-wrap items-end gap-2 ${panelClassName || 'mt-3 w-full'}`}>
            {/* Width is set on the wrapper: the Field label is content-sized,
                so the input's percentage must resolve against a definite
                wrapper (half the panel = the picker column above). */}
            <div className="w-full sm:w-[calc(50%_-_6px)] order-3 sm:order-1">
              <Field label={`Last N days${phone ? '' : ' (max 730)'}`}>
                <input
                  className="input w-full text-[13px]"
                  type="number"
                  min={1}
                  max={730}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="e.g. 45"
                />
              </Field>
            </div>

            {/* Divider: full-width hr + circle badge on mobile (own line);
                on PC it collapses to the plain word "or" inline between the
                Last N Days and From/To sections, with auto margins so it sits
                exactly midway between them (equal space both sides). */}
            <div className="w-full flex items-center justify-center order-2 sm:w-auto sm:mx-auto sm:justify-normal" aria-hidden="true">
              <hr className="w-full border-0 border-t border-slate-700/70 sm:hidden" />
              <span className="hidden sm:inline-block sm:mx-2 text-xs text-slate-400">or</span>
            </div>

            {/* From and To share one row; Apply is pulled below "Last N days"
                on mobile (order-4) and sits at the end of the row on PC
                (sm:order-3). mx-auto centers the From/To group in the leftover
                space; the PC-only -translate-x-6 nudges it slightly left. */}
            <div className="flex flex-col gap-2 w-full sm:flex-row sm:items-end sm:gap-2 sm:mx-auto sm:w-auto sm:-translate-x-6 order-1 sm:order-3">
              <Field label="From">
                <input className="input w-full sm:w-[115px] md:w-[135px] text-[13px]" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className="input w-full sm:w-[115px] md:w-[135px] text-[13px]" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </Field>
            </div>
            <button
              type="button"
              className="btn-primary text-xs px-5 w-full sm:w-auto mt-2 sm:mt-0 order-4 sm:order-3"
              onClick={() => onChange(customPeriod(customDays ? Number(customDays) : undefined, customFrom || undefined, customTo || undefined))}
              >
                Apply
            </button>
            {isCustom && <span className="hidden sm:inline text-xs text-brand-300 pb-2.5 order-5">Active: {period.label}</span>}
            {isCustom && <div className="sm:hidden mt-2 text-xs text-brand-300 text-center order-5">Active: {period.label}</div>}
          </div>
        )}
      </div>
    )
  }

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
