export function ugx(v: string | number | null | undefined): string {
  const n = Number(v || 0)
  return `UGX ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`
}

export function compactUgx(v: string | number | null | undefined): string {
  const n = Number(v || 0)
  // Round to the nearest 100 first, then K/M with trailing zeros trimmed:
  // 1,500 → 1.5K · 68,500 → 68.5K · 1,575,500 → 1.5755M · 2,000,000 → 2M
  if (Math.abs(n) >= 1_000_000) return `UGX ${trim((Math.round(n / 100) * 100) / 1_000_000)}M`
  if (Math.abs(n) >= 1_000) return `UGX ${trim((Math.round(n / 100) * 100) / 1_000)}K`
  return `UGX ${n}`
}

/** Strip float dust and trailing zeros: 1.5755 → "1.5755", 2 → "2", 68.5 → "68.5". */
function trim(x: number): string {
  return String(Number(x.toFixed(4)))
}

export function num(v: string | number | null | undefined): string {
  return Number(v || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
}

/** Day + month only ("22 Sep") — the top line of the stacked mobile date cell. */
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Kampala' })
}

/** Time of day ("22:10") — the bottom line of the stacked mobile date cell. */
export function timeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank: 'Bank',
  card: 'Card',
  credit: 'Credit',
  credit_settlement: 'Credit Settlement',
}
