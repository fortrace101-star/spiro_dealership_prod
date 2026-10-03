import { api } from './api'
import { PAYMENT_LABELS, dateOnly, ugx } from './format'
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
  const isToday = period.id === 'today'

  // One round-trip: the server aggregates every section for the exact window
  // (Workstream I) so the PDF can never disagree with the selected period.
  const pr = await api.periodReport(from, to)
  const kpi = pr.kpi
  const daily = pr.daily ?? []
  const hourly = pr.hourly
    ? pr.hourly.map((h) => ({ hour: Number(h.hour), revenue: Number(h.revenue), profit: Number(h.profit) }))
    : null
  const payments = pr.payments.map((p) => ({ payment_method: p.payment_method, amount: Number(p.amount) }))
  const top = pr.top_products.map((p) => ({
    name: p.name,
    qty: Number(p.qty),
    revenue: Number(p.revenue),
    profit: Number(p.profit),
  }))
  const cashiers = pr.cashiers.map((c) => ({
    full_name: c.full_name,
    sales_count: Number(c.sales_count),
    revenue: Number(c.revenue),
    profit: Number(c.profit),
    discounts: Number(c.discounts),
  }))
  const low = pr.low_stock ?? []
  const reorderLists = pr.reorders?.lists ?? []
  const reorderCounts = pr.reorders?.by_status ?? []
  const consignmentRows = pr.consignments?.rows ?? []
  const consignmentTotals = pr.consignments?.totals
  const reservationInfo = pr.reservations
  const installmentRows = reservationInfo?.payments ?? []

  const writer = new PdfWriter(`Spiro Performance Report`)
  writer.header(
    [
      `${period.label} · ${from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`}`,
      `Generated ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    ].join(' · '),
  )

    // ---- KPI summary ----
    writer.sectionTitle('Executive summary')
  writer.caption('Key performance indicators for ' + reportPeriodSuffix(period))
  writer.divider()
  writer.keyValues([
    { label: 'Revenue', value: ugx(kpi.revenue) },
    { label: 'Gross profit', value: `${ugx(kpi.profit)} (${kpi.revenue ? ((kpi.profit / kpi.revenue) * 100).toFixed(1) : '0.0'}%)` },
    { label: 'Transactions', value: String(kpi.sales_count) },
    { label: 'Average transaction', value: ugx(kpi.avg_transaction) },
    { label: 'Discounts given', value: ugx(kpi.discounts) },
  ], 2, 6)
  // Breathe between the Executive-summary sections.
  writer.divider()
  writer.keyValues([
    { label: 'Bikes sold', value: String(kpi.bikes_sold) },
    { label: 'Parts sold', value: String(kpi.parts_sold) },
  ], 2, 6)
  writer.divider()
  writer.keyValues([
    { label: 'Credit collected (period)', value: ugx(kpi.credit_collected) },
    { label: 'Credit outstanding', value: ugx(kpi.credit_outstanding) },
  ], 2, 6)
  writer.divider()
  writer.keyValues([
    { label: 'Reservations collected', value: ugx(Number(pr.reservations.installments_collected) + Number(pr.reservations.down)) },
    { label: 'Stock value', value: ugx(kpi.stock_value) },
  ], 2, 6)
  writer.spacer(2)

  // ---- Graph: revenue & profit over the period ----
  if (isToday && hourly) {
      writer.sectionTitle('Revenue & profit (hourly)')
  writer.caption('Hourly revenue and gross profit for ' + reportPeriodSuffix(period))
  writer.divider()
    writer.barChart({
      labels: hourly.map((h) => `${String(h.hour).padStart(2, '0')}:00`),
      values: hourly.map((h) => h.revenue),
      values2: hourly.map((h) => h.profit),
      legend: ['Revenue', 'Profit'],
      height: 56,
    })
  } else if (daily.length > 0) {
      writer.sectionTitle('Revenue & profit (daily)')
  writer.caption('Daily revenue and gross profit for ' + reportPeriodSuffix(period))
  writer.divider()
    writer.barChart({
      labels: daily.map((d) =>
        new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      ),
      values: daily.map((d) => Number(d.revenue)),
      values2: daily.map((d) => Number(d.profit)),
      legend: ['Revenue', 'Profit'],
      height: 56,
    })
  }
  // ---- Graph + table: payment mix ----
  const payRows = payments.map((p) => ({
    label: PAYMENT_LABELS[p.payment_method] || p.payment_method,
    value: Number(p.amount),
  }))
    writer.sectionTitle('Payment mix')
  writer.caption('Transactions by payment method for the period')
  writer.divider()
  if (payRows.length === 0) {
    writer.keyValues([{ label: 'No payments recorded in this period', value: '' }])
  } else {
    writer.hBars(payRows.map((p, i) => ({ ...p, color: MIX_COLORS[i % MIX_COLORS.length] })))
    const total = payRows.reduce((s, p) => s + p.value, 0)
    writer.table({
      columns: [
        { label: 'Method', width: 70 },
        { label: 'Amount', align: 'right' },
        { label: 'Share', align: 'right' },
      ],
      rows: payRows.map((p) => [p.label, ugx(p.value), total ? `${((p.value / total) * 100).toFixed(1)}%` : '0.0%']),
      totals: [['Total', ugx(total), '100.0%']],
    })
  }

  // ---- Table: top products ----
    writer.sectionTitle(`Top products · ${period.label}`)
  writer.caption('Best-selling products by revenue for ' + period.label)
  writer.divider()
  if (top.length === 0) {
    writer.keyValues([{ label: 'No sales in this period', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Product' },
        { label: 'Qty', align: 'right', width: 22 },
        { label: 'Revenue', align: 'right', width: 38 },
        { label: 'Profit', align: 'right', width: 38 },
      ],
      rows: top.map((p) => [p.name, String(p.qty), ugx(p.revenue), ugx(p.profit)]),
    })
  }

  // ---- Table: staff performance ----
    writer.sectionTitle('Staff performance')
  writer.caption('Sales and discounts by team member for the period')
  writer.divider()
  const activeCashiers = cashiers.filter((c) => c.sales_count > 0)
  if (activeCashiers.length === 0) {
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
      rows: activeCashiers.map((c) => [
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
  writer.caption('Products at or below their reorder level')
  writer.divider()
  if (low.length === 0) {
    writer.keyValues([{ label: 'All stock levels healthy', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Product' },
        { label: 'SKU', width: 40 },
        { label: 'In stock', align: 'right', width: 26 },
        { label: 'Reorder at', align: 'right', width: 28 },
      ],
      rows: low.map((p) => [p.name, p.sku, String(p.stock_qty), String(p.reorder_level)]),
    })
  }

  // ---- Table: reorder lists prepared in period (incl. cancelled) ----
    writer.sectionTitle(`Reorder lists prepared · ${period.label}`)
  writer.caption('Reorder lists prepared in the period')
  writer.divider()
  if (reorderLists.length === 0) {
    writer.keyValues([{ label: 'No reorder lists prepared in this period', value: '' }])
  } else {
    if (reorderCounts.length > 0) {
      const prepared = reorderCounts.reduce((s, r) => s + Number(r.n || 0), 0)
      const cancelled = reorderCounts
        .filter((r) => String(r.status).toLowerCase() === 'cancelled')
        .reduce((s, r) => s + Number(r.n || 0), 0)
      writer.keyValues([
        { label: 'Lists prepared', value: String(prepared) },
        { label: 'Cancelled', value: String(cancelled) },
      ])
    }
    writer.table({
      columns: [
        { label: 'Title' },
        { label: 'Status', width: 30 },
        { label: 'Items', align: 'right', width: 20 },
        { label: 'By', width: 44 },
        { label: 'Date', width: 30 },
      ],
      rows: reorderLists.map((r) => [
        r.title,
        r.status,
        String(r.item_count ?? 0),
        r.created_by_name || '—',
        dateOnly(r.created_at),
      ]),
    })
  }

  // ---- Table: stock received (consignments) in period ----
    writer.sectionTitle(`Stock received · ${period.label}`)
  writer.caption('Consignments and stock received in the period')
  writer.divider()
  if (consignmentRows.length === 0) {
    writer.keyValues([{ label: 'No stock received in this period', value: '' }])
  } else {
    writer.table({
      columns: [
        { label: 'Reference' },
        { label: 'Supplier', width: 48 },
        { label: 'Items', align: 'right', width: 34 },
        { label: 'Delivery', align: 'right', width: 34 },
        { label: 'Date', width: 30 },
      ],
      rows: consignmentRows.map((c) => [
        c.reference,
        c.supplier,
        ugx(c.items_total),
        ugx(c.delivery_cost),
        dateOnly(c.created_at),
      ]),
      totals: consignmentTotals
        ? [[
            `Total (${consignmentTotals.count})`,
            '',
            ugx(consignmentTotals.items_total),
            ugx(consignmentTotals.delivery),
            '',
          ]]
        : undefined,
    })
  }

  // ---- Reservations & installments ----
    writer.sectionTitle(`Reservations · ${period.label}`)
  writer.caption('Reservation revenue and installment payments for the period')
  writer.divider()
  const hasReservations =
    reservationInfo && (reservationInfo.count > 0 || reservationInfo.installments_count > 0)
  if (!hasReservations || !reservationInfo) {
    writer.keyValues([{ label: 'No reservations in this period', value: '' }])
  } else {
    writer.keyValues([
      { label: 'Reservations', value: String(reservationInfo.count) },
      { label: 'Down payments', value: ugx(reservationInfo.down) },
      { label: 'Installments collected', value: ugx(reservationInfo.installments_collected) },
      { label: 'Installment payments', value: String(reservationInfo.installments_count) },
    ])
    if (installmentRows.length > 0) {
      writer.table({
        columns: [
          { label: 'Method', width: 44 },
          { label: 'Amount', align: 'right', width: 34 },
          { label: 'Received by', width: 52 },
          { label: 'Date', width: 30 },
        ],
        rows: installmentRows.map((p) => [
          PAYMENT_LABELS[p.payment_method] || p.payment_method,
          ugx(p.amount),
          p.paid_by_name || '—',
          dateOnly(p.created_at),
        ]),
      })
    }
  }

  writer.save(`spiro report - ${reportPeriodSuffix(period)}.pdf`)
}



