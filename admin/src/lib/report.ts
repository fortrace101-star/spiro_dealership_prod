import { api } from './api'
import { PAYMENT_LABELS, ugx } from './format'
import { PdfWriter } from './pdf'
import { resolveRange } from './periods'
import type { Period } from './periods'

/** dd MMM yyyy (en-GB) — the date half of the report filename convention. */
function fmtDate(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** "19 Sep 2026 to 02 Oct 2026 - 2 weeks" — dates + the period's short form. */
export function reportPeriodSuffix(period: Period): string {
  const { from, to } = resolveRange(period)
  const short = period.short ?? period.label
  if (period.id === 'today') return `${fmtDate(from)} - ${short}`
  return `${fmtDate(from)} to ${fmtDate(to)} - ${short}`
}

const MIX_COLORS: [number, number, number][] = [
  [18, 183, 106],
  [14, 165, 233],
  [139, 92, 246],
  [245, 158, 11],
  [239, 68, 68],
  [100, 116, 139],
]

/**
 * Build the period performance report (KPIs + graphs + tables) and hand it to
 * the browser download. Data is fetched fresh so the PDF always matches the
 * selected window rather than whatever happens to be on screen.
 */
export async function downloadPeriodReport(period: Period): Promise<void> {
  const { from, to } = resolveRange(period)
  const win = { from, to }
  const dayCount = period.days ?? 30
  const isToday = period.id === 'today'

  const [range, hourlyR, paymentsR, topR, cashiersR, lowR] = await Promise.all([
    api.range(dayCount, win),
    isToday ? api.hourly() : Promise.resolve(null),
    api.payments(dayCount, win),
    api.topProducts(dayCount, 'revenue', win),
    api.cashiers(dayCount, win),
    api.lowStock(),
  ])

  const kpi = range.kpi
  const writer = new PdfWriter(`Spiro Performance Report`)
  writer.heading(
    [
      `${period.label} · ${from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`}`,
      `Generated ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    ].join(' · '),
  )

  // ---- KPI summary ----
  writer.sectionTitle('Key figures')
  writer.keyValues([
    { label: 'Revenue', value: ugx(kpi.revenue) },
    { label: 'Gross profit', value: `${ugx(kpi.profit)} (${kpi.revenue ? ((kpi.profit / kpi.revenue) * 100).toFixed(1) : '0.0'}%)` },
    { label: 'Transactions', value: String(kpi.sales_count) },
    { label: 'Average transaction', value: ugx(kpi.avg_transaction) },
    { label: 'Bikes sold', value: String(kpi.bikes_sold) },
    { label: 'Parts sold', value: String(kpi.parts_sold) },
    { label: 'Stock value', value: ugx(kpi.stock_value) },
    { label: 'Credit outstanding', value: ugx(kpi.credit_outstanding) },
  ])

  // ---- Graph: revenue & profit over the period ----
  if (isToday && hourlyR) {
    writer.sectionTitle('Revenue & profit (hourly)')
    writer.barChart({
      labels: hourlyR.series.map((h) => `${String(h.hour).padStart(2, '0')}:00`),
      values: hourlyR.series.map((h) => h.revenue),
      values2: hourlyR.series.map((h) => h.profit),
      legend: ['Revenue', 'Profit'],
      height: 56,
    })
  } else if (range.daily.length > 0) {
    writer.sectionTitle('Revenue & profit (daily)')
    writer.barChart({
      labels: range.daily.map((d) =>
        new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      ),
      values: range.daily.map((d) => Number(d.revenue)),
      values2: range.daily.map((d) => Number(d.profit)),
      legend: ['Revenue', 'Profit'],
      height: 56,
    })
  }
  // ---- Graph + table: payment mix ----
  const payments = paymentsR.payments.map((p) => ({
    label: PAYMENT_LABELS[p.payment_method] || p.payment_method,
    value: Number(p.amount),
  }))
  writer.sectionTitle('Payment mix')
  if (payments.length === 0) {
    writer.keyValues([{ label: 'No payments recorded in this period', value: '' }])
  } else {
    writer.hBars(payments.map((p, i) => ({ ...p, color: MIX_COLORS[i % MIX_COLORS.length] })))
    const total = payments.reduce((s, p) => s + p.value, 0)
    writer.table({
      columns: [
        { label: 'Method', width: 70 },
        { label: 'Amount', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: payments.map((p) => [p.label, ugx(p.value), total ? `${((p.value / total) * 100).toFixed(1)}%` : '0.0%']),
      totals: [['Total', ugx(total), '100.0%']],
    })
  }

  // ---- Table: top products ----
  writer.sectionTitle(`Top products · ${period.label}`)
  if (topR.products.length === 0) {
    writer.keyValues([{ label: 'No sales in this period', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Product' },
        { label: 'Qty', align: 'right', width: 22 },
        { label: 'Revenue', align: 'right', width: 38 },
        { label: 'Profit', align: 'right', width: 38 },
      ],
      rows: topR.products.map((p) => [p.name, String(p.qty), ugx(p.revenue), ugx(p.profit)]),
    })
  }

  // ---- Table: staff performance ----
  writer.sectionTitle('Staff performance')
  if (cashiersR.cashiers.length === 0) {
    writer.keyValues([{ label: 'No sales for this period', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Name' },
        { label: 'Sales', align: 'right', width: 22 },
        { label: 'Revenue', align: 'right', width: 38 },
        { label: 'Profit', align: 'right', width: 38 },
        { label: 'Discounts', align: 'right', width: 32 },
      ],
      rows: cashiersR.cashiers.map((c) => [
        c.full_name,
        String(c.sales_count),
        ugx(c.revenue),
        ugx(c.profit),
        ugx(c.discounts),
      ]),
    })
  }

  // ---- Table: reorder alerts ----
  writer.sectionTitle('Reorder alerts')
  if (lowR.products.length === 0) {
    writer.keyValues([{ label: 'All stock levels healthy', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Product' },
        { label: 'SKU', width: 40 },
        { label: 'In stock', align: 'right', width: 26 },
        { label: 'Reorder at', align: 'right', width: 28 },
      ],
      rows: lowR.products.map((p) => [p.name, p.sku, String(p.stock_qty), String(p.reorder_level)]),
    })
  }

  writer.save(`spiro report - ${reportPeriodSuffix(period)}.pdf`)
}



