/** One-click PDF download pipeline: generates a real .pdf file in the
 *  browser and saves it straight to Downloads — no print dialog, no new tab.
 *  Every "Download PDF" button shares this writer so documents look consistent.
 *  POS mirror of the admin app's src/lib/pdf.ts, so both apps emit the same file. */
import { jsPDF } from 'jspdf'

// A4 portrait, millimetres.
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 14
const CONTENT_W = PAGE_W - MARGIN * 2
const FOOTER_Y = PAGE_H - 8
// Reserve room above the footer so rows never collide with it.
const BOTTOM = FOOTER_Y - 6

export type PdfAlign = 'left' | 'right'

export interface PdfColumn {
  label: string
  align?: PdfAlign
  /** Column width in mm; columns without one share the remaining width equally. */
  width?: number
}

export interface PdfTableSpec {
  columns: PdfColumn[]
  rows: string[][]
  /** Bold rows under a heavy rule (totals / landed cost). */
  totals?: string[][]
}

/** Line height for a font size in pt, converted to mm (1.15 is jsPDF's factor). */
function lh(sizePt: number): number {
  return sizePt * 1.15 * 0.352778
}

export class PdfWriter {
  private doc = new jsPDF({ unit: 'mm', format: 'a4' })
  private y = MARGIN

  constructor(private title: string) {}

  /** Title + wrapped metadata line + separator rule. */
  heading(meta: string): this {
    const d = this.doc
    d.setFont('helvetica', 'bold')
    d.setFontSize(16)
    d.setTextColor(15, 23, 42)
    this.y += 6
    d.text(this.title, MARGIN, this.y)
    this.y += lh(16)
    d.setFont('helvetica', 'normal')
    d.setFontSize(9)
    d.setTextColor(100, 116, 139)
    const lines = d.splitTextToSize(meta, CONTENT_W) as string[]
    for (const line of lines) {
      // A very long meta line must never run into the table or footer.
      if (this.y > BOTTOM) {
        d.addPage()
        this.y = MARGIN
      }
      d.text(line, MARGIN, this.y + 2)
      this.y += lh(9)
    }
    this.y += 4
    this.rule(0.4, [203, 213, 225])
    this.y += 6
    return this
  }

  /** Table with repeating header across page breaks; rows wrap cell text. */
  table(spec: PdfTableSpec): this {
    const { columns, rows, totals } = spec
    // Resolve widths: explicit mm, remainder split equally among the rest.
    const fixed = columns.reduce((s, c) => s + (c.width || 0), 0)
    const autoCount = columns.filter((c) => !c.width).length
    const autoWidth = autoCount > 0 ? (CONTENT_W - fixed) / autoCount : 0
    const widths = columns.map((c) => c.width || autoWidth)
    const xs: number[] = []
    let x = MARGIN
    for (const w of widths) {
      xs.push(x)
      x += w
    }

    const drawHeader = () => {
      const d = this.doc
      d.setFont('helvetica', 'bold')
      d.setFontSize(8)
      d.setTextColor(100, 116, 139)
      columns.forEach((c, i) => {
        const label = c.label.toUpperCase()
        if (c.align === 'right') d.text(label, xs[i] + widths[i] - 1, this.y + 3, { align: 'right' })
        else d.text(label, xs[i], this.y + 3)
      })
      this.y += lh(8) + 3
      this.rule(0.4, [203, 213, 225])
      this.y += 3
    }

    const ensure = (h: number): boolean => {
      if (this.y + h <= BOTTOM) return false
      this.doc.addPage()
      this.y = MARGIN
      drawHeader()
      return true
    }

    const drawRow = (cells: string[], bold: boolean) => {
      const d = this.doc
      const pad = 3
      const wrapped = cells.map((cell, i) => d.splitTextToSize(cell, widths[i] - 2) as string[])
      const maxLines = Math.max(...wrapped.map((l) => l.length), 1)
      const rowH = maxLines * lh(10) + pad
      ensure(rowH)
      d.setFont('helvetica', bold ? 'bold' : 'normal')
      d.setFontSize(10)
      d.setTextColor(15, 23, 42)
      wrapped.forEach((lines, i) => {
        let baseline = this.y + 3
        for (const line of lines) {
          if (columns[i].align === 'right') d.text(line, xs[i] + widths[i] - 1, baseline, { align: 'right' })
          else d.text(line, xs[i], baseline)
          baseline += lh(10)
        }
      })
      this.y += rowH
    }

    drawHeader()
    for (const row of rows) drawRow(row, false)
    if (totals && totals.length) {
      // Heavy rule closes the body; bold rows sit under it.
      this.y += 2
      this.rule(0.7, [15, 23, 42])
      this.y += 4
      for (const row of totals) drawRow(row, true)
    }
    this.y += 4
    return this
  }

  /** Adds footers to every page, then triggers the browser download. */
  save(filename?: string): void {
    const d = this.doc
    const stamp = new Date().toISOString().slice(0, 10)
    const pages = d.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      d.setPage(i)
      d.setFont('helvetica', 'normal')
      d.setFontSize(8)
      d.setTextColor(148, 163, 184)
      d.text(`${this.title} · page ${i} of ${pages}`, MARGIN, FOOTER_Y)
      d.text(`Generated ${stamp}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' })
    }
    d.save(filename || `${slug(this.title)}-${stamp}.pdf`)
  }

  private rule(width: number, color: [number, number, number]): void {
    this.doc.setDrawColor(...color)
    this.doc.setLineWidth(width)
    this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y)
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  )
}

// ---------------------------------------------------------------------------
// Receipt PDF — 80mm thermal-style roll, one continuous page.
// Vector text (selectable, no canvas rasterisation), same house look as the
// A4 writer above. Used by the Sale Completed modal's "Print receipt" button.
// ---------------------------------------------------------------------------

const R_W = 80 // 80mm receipt roll
const R_M = 5 // side margin
const R_CW = R_W - R_M * 2

export interface ReceiptLine {
  name: string
  qty: number
  unit_price: number
  line_total: number
}

export interface ReceiptData {
  receiptNo: string
  createdAt: string
  cashier: string
  device: string
  customerName?: string | null
  customerPhone?: string | null
  items: ReceiptLine[]
  subtotal: number
  discount: number
  total: number
  paymentLabel: string
  amountPaid: number
  changeDue: number
  /** Credit sales await admin approval — no money moves yet. */
  awaitingApproval?: boolean
  /** Recorded offline; will sync when back online. */
  pendingSync?: boolean
  /** Formats a number as UGX (same helper the screen uses). */
  fmt: (n: number) => string
}

/** Draw an 80mm receipt PDF and trigger the browser download. */
export function saveReceiptPdf(data: ReceiptData, filename: string): void {
  const doc = new jsPDF({ unit: 'mm', format: [R_W, 200] })
  let y = 8
  const pageH = 200 // matches the [R_W, 200] format; rolls flow onto extra pages

  const ensure = (h: number) => {
    if (y + h > pageH - 6) {
      doc.addPage([R_W, 200], 'portrait')
      y = 8
    }
  }

  /** Centre/left text helper with wrapping; returns the y after the block. */
  const text = (
    s: string,
    opts: { size?: number; bold?: boolean; muted?: boolean; align?: 'left' | 'center' | 'right'; gap?: number } = {},
  ) => {
    const { size = 8, bold = false, muted = false, align = 'left', gap = 1.5 } = opts
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    if (muted) doc.setTextColor(100, 116, 139)
    else doc.setTextColor(15, 23, 42)
    const lines = doc.splitTextToSize(s, R_CW) as string[]
    for (const line of lines) {
      ensure(size * 0.353 + 1)
      const x =
        align === 'center' ? R_W / 2 : align === 'right' ? R_W - R_M : R_M
      doc.text(line, x, y, { align })
      y += size * 0.353 * 1.25
    }
    y += gap
  }

  const rule = () => {
    ensure(3)
    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.2)
    doc.setLineDashPattern([1, 1], 0)
    doc.line(R_M, y, R_W - R_M, y)
    doc.setLineDashPattern([], 0)
    y += 3
  }

  /** Right-aligned money line: label left, amount right, same baseline. */
  const moneyRow = (label: string, amount: string, opts: { bold?: boolean; size?: number; muted?: boolean } = {}) => {
    const { bold = false, size = 8, muted = false } = opts
    ensure(size * 0.353 + 2)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    if (muted) doc.setTextColor(100, 116, 139)
    else doc.setTextColor(15, 23, 42)
    doc.text(label, R_M, y)
    doc.text(amount, R_W - R_M, y, { align: 'right' })
    y += size * 0.353 * 1.3
  }

  // ---- Header ----
  text('SPIRO E-BIKES & PARTS', { size: 11, bold: true, align: 'center', gap: 0.5 })
  text('Kampala, Uganda · +256 700 000 000', { size: 7, muted: true, align: 'center', gap: 1 })
  rule()

  // ---- Meta ----
  text(`Receipt: ${data.receiptNo}`, { bold: true, gap: 0.5 })
  text(`${data.createdAt} · ${data.cashier} · ${data.device}`, { size: 7, muted: true, gap: 0.5 })
  if (data.customerName) {
    text(
      `Customer: ${data.customerName}${data.customerPhone ? ` (${data.customerPhone})` : ''}`,
      { size: 7, muted: true, gap: 0.5 },
    )
  }
  rule()

  // ---- Items ----
  for (const i of data.items) {
    ensure(9)
    // Name (wrapped) on the left, line total flush right on the first line.
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(15, 23, 42)
    const nameLines = doc.splitTextToSize(i.name, R_CW - 18) as string[]
    let baseline = y
    for (const line of nameLines) {
      doc.text(line, R_M, baseline)
      baseline += 3.2
    }
    doc.text(data.fmt(i.line_total), R_W - R_M, y, { align: 'right' })
    y = baseline
    doc.setFontSize(7)
    doc.setTextColor(100, 116, 139)
    doc.text(`${i.qty} × ${data.fmt(i.unit_price)}`, R_M, y)
    y += 4
  }
  rule()

  // ---- Totals ----
  moneyRow('Subtotal', data.fmt(data.subtotal))
  if (data.discount > 0) moneyRow('Discount', `- ${data.fmt(data.discount)}`, { muted: true })
  y += 1
  moneyRow('TOTAL', data.fmt(data.total), { bold: true, size: 11 })
  y += 1
  if (data.awaitingApproval) {
    moneyRow('Status', 'AWAITING APPROVAL', { bold: true })
  } else {
    moneyRow(`Paid (${data.paymentLabel})`, data.fmt(data.amountPaid))
    if (data.changeDue > 0) moneyRow('Change', data.fmt(data.changeDue), { muted: true })
  }
  rule()

  // ---- Footer ----
  text('Asante sana! Warranty at receipt presentation.', { size: 7, muted: true, align: 'center', gap: 1 })
  if (data.pendingSync) {
    text('[Recorded offline — will sync]', { size: 7, muted: true, align: 'center', gap: 0 })
  }

  doc.save(filename)
}
