/** One-click PDF download pipeline: generates a real .pdf file in the
 *  browser and saves it straight to Downloads — no print dialog, no new tab.
 *  Every "Download PDF" button shares this writer so documents look consistent. */
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
