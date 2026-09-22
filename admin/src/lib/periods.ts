/** Named performance windows for the reports pages. */
export interface Period {
  id: string
  label: string
  /** Compact label for phone-width pickers (falls back to `label`) */
  short?: string
  /** Day-count window ending today; ignored when from/to are set */
  days?: number
  /** Explicit calendar window (ISO dates) */
  from?: string
  to?: string
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOf(unit: 'week' | 'month' | 'quarter' | 'year', offset = 0): Date {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (unit === 'week') {
    const dow = (d.getDay() + 6) % 7 // Monday = 0
    d.setDate(d.getDate() - dow - offset * 7)
  } else if (unit === 'month') {
    d.setMonth(d.getMonth() - offset, 1)
  } else if (unit === 'quarter') {
    d.setMonth(Math.floor(d.getMonth() / 3) * 3 - offset * 3, 1)
  } else {
    d.setFullYear(d.getFullYear() - offset, 0, 1)
  }
  return d
}

function endOf(unit: 'week' | 'month' | 'quarter' | 'year', offset = 0): Date {
  const start = startOf(unit, offset)
  const d = new Date(start)
  if (unit === 'week') d.setDate(d.getDate() + 6)
  else if (unit === 'month') d.setMonth(d.getMonth() + 1, 0)
  else if (unit === 'quarter') d.setMonth(d.getMonth() + 3, 0)
  else d.setFullYear(d.getFullYear(), 11, 31)
  return d
}

function startOfHalf(offset = 0): Date {
  const now = new Date()
  // H1 starts Jan 1, H2 starts Jul 1
  return new Date(now.getFullYear(), now.getMonth() >= 6 ? 6 : 0, 1)
}

export const PERIODS: Period[] = [
  { id: 'today', label: 'Today', short: 'Today', days: 1 },
  { id: '3d', label: 'Past 3 days', short: '3 days', days: 3 },
  { id: 'week', label: 'This week', short: 'Week', from: iso(startOf('week')), to: iso(new Date()) },
  { id: '2w', label: 'Past 2 weeks', short: '2 weeks', days: 14 },
  { id: 'month', label: 'This month', short: 'Month', from: iso(startOf('month')), to: iso(new Date()) },
  { id: 'quarter', label: 'This quarter', short: 'Quarter', from: iso(startOf('quarter')), to: iso(new Date()) },
  { id: 'half', label: 'This half', short: 'Half', from: iso(startOfHalf()), to: iso(new Date()) },
  { id: 'year', label: 'This year', short: 'Year', from: iso(startOf('year')), to: iso(new Date()) },
]

/** Custom windows: last N days or a full from/to pair, capped at 2 years. */
export function customPeriod(days?: number, from?: string, to?: string): Period {
  if (from && to) return { id: 'custom', label: 'Custom range', short: 'Custom', from, to }
  const d = Math.min(Math.max(Number(days) || 30, 1), 730)
  return { id: 'custom', label: `Last ${d} days`, short: `${d}d`, days: d }
}
