export function ugx(v: string | number | null | undefined): string {
  const n = Number(v || 0)
  return `UGX ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`
}

export function compactUgx(v: string | number | null | undefined): string {
  const n = Number(v || 0)
  if (Math.abs(n) >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `UGX ${(n / 1_000).toFixed(0)}K`
  return `UGX ${n}`
}

export function num(v: string | number | null | undefined): string {
  return Number(v || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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
}
