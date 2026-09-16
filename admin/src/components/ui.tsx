import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  accent,
  onClick,
}: {
  label: string
  value: string
  delta?: string
  accent?: boolean
  onClick?: () => void
}) {
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-label={interactive ? `${label} — view details` : undefined}
      className={cn(
        'card p-5 text-left transition',
        accent && 'bg-gradient-to-br from-brand-500/15 to-transparent border-brand-500/30',
        interactive && 'cursor-pointer hover:border-brand-500/50 hover:bg-[#161b24] focus:outline-none focus:ring-1 focus:ring-brand-500/50',
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={cn('mt-2 text-2xl font-bold text-white', accent && 'text-brand-300')}>{value}</div>
      {delta && <div className="mt-1 text-xs text-slate-500">{delta}</div>}
      {interactive && <div className="mt-2 text-[11px] text-brand-300/80">Click for details →</div>}
    </button>
  )
}

const BADGE_COLORS: Record<string, string> = {
  cash: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  mobile_money: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
  bank: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  card: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  credit: 'bg-red-500/15 text-red-300 border-red-500/20',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/20',
  in_stock: 'bg-brand-500/15 text-brand-300 border-brand-500/20',
  sold: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  reserved: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
}

export function Badge({ kind, children }: { kind?: string; children: ReactNode }) {
  const cls = (kind && BADGE_COLORS[kind]) || 'bg-slate-500/15 text-slate-300 border-slate-500/20'
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium capitalize', cls)}>{children}</span>
}

export function EmptyState({ message }: { message: string }) {
  return <div className="text-center text-sm text-slate-600 py-12">{message}</div>
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 rounded-full border-2 border-slate-700 border-t-brand-400 animate-spin" />
    </div>
  )
}
