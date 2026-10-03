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

    /** Headed-paper title block drawn at the top of page 1. Unlike a full-bleed
   *  `cover()`, the report body starts on this same page — the title and meta
   *  sit in the top margin above the first section instead of consuming a whole
   *  page, so nothing gets hidden behind a cover. */
  header(subtitle: string): this {
    const d = this.doc
    d.setFont('helvetica', 'bold')
    d.setFontSize(22)
    d.setTextColor(15, 23, 42)
    d.text(this.title, PAGE_W / 2, MARGIN + 10, { align: 'center' })
    d.setFont('helvetica', 'normal')
    d.setFontSize(9)
    d.setTextColor(100, 116, 139)
    // Give the subtitle a little extra letter-spacing so the period line reads comfortably across the page.
    d.setCharSpace(0.4)
    const lines = d.splitTextToSize(subtitle, CONTENT_W * 0.78) as string[]
    let y = MARGIN + 18
    for (const line of lines) {
      d.text(line, PAGE_W / 2, y, { align: 'center' })
      y += lh(9)
    }
    d.setCharSpace(0)
    this.y = y + 4
    this.rule(0.4, [203, 213, 225])
    this.y += 6
    return this
  }

  /** Caption line rendered just above the element it describes (tables/charts).
   *  Italic, muted, wraps across the full content width. */
  caption(text: string): this {
    const d = this.doc
    if (this.y > BOTTOM) {
      d.addPage()
      this.y = MARGIN
    }
    d.setFont('helvetica', 'italic')
    d.setFontSize(8.5)
    d.setTextColor(100, 116, 139)
    const lines = d.splitTextToSize(text, CONTENT_W) as string[]
    for (const line of lines) {
      if (this.y > BOTTOM) {
        d.addPage()
        this.y = MARGIN
      }
      d.text(line, MARGIN, this.y)
      this.y += lh(8.5)
    }
    this.y += 3
    return this
  }

  /** Thin section-divider rule across the content area. */
  divider(width = 0.4, color: [number, number, number] = [226, 232, 240]): this {
    this.y += 2
    this.rule(width, color)
    this.y += 4
    return this
  }

  /** Pure vertical whitespace — breathing room between sections without a rule. */
  spacer(h = 6): this {
    this.y += h
    return this
  }

  /** Table with repeating header across page breaks; rows wrap cell text. */
  sectionTitle(text: string): this {
    const d = this.doc
    // Keep the heading with the content that follows it.
    if (this.y > BOTTOM - 18) {
      d.addPage()
      this.y = MARGIN
    }
    d.setFont('helvetica', 'bold')
    d.setFontSize(11)
    d.setTextColor(15, 23, 42)
    d.text(text, MARGIN, this.y + 3)
    this.y += lh(11) + 5
    return this
  }

  /** Key/value lines under a section title (KPI summary block).
   *  `rowGap` (mm) adds vertical breathing room between rows; the Executive
   *  summary passes a larger value so the KPIs read as distinct lines. */
  keyValues(pairs: { label: string; value: string }[], columns = 2, rowGap = 0): this {
    const d = this.doc
    const colW = CONTENT_W / columns
    const rowH = lh(10) + 5 + rowGap
    let row = 0
    let col = 0
    const drawPair = (label: string, value: string, c: number, y: number) => {
      const x = MARGIN + c * colW
      d.setFont('helvetica', 'normal')
      d.setFontSize(9)
      d.setTextColor(100, 116, 139)
      d.text(label, x, y)
      d.setFont('helvetica', 'bold')
      d.setFontSize(11)
      d.setTextColor(15, 23, 42)
      d.text(value, x, y + lh(11))
    }
    for (const p of pairs) {
      const y = this.y + row * rowH
      if (y + rowH > BOTTOM) {
        d.addPage()
        this.y = MARGIN
        row = 0
        col = 0
      }
      drawPair(p.label, p.value, col, this.y + row * rowH)
      col += 1
      if (col >= columns) {
        col = 0
        row += 1
      }
    }
    if (col !== 0) row += 1
    this.y += row * rowH + 6
    return this
  }

  /** Vertical bars drawn as native PDF rectangles (no rasterisation needed). */
  barChart(opts: { labels: string[]; values: number[]; values2?: number[]; height?: number; legend?: [string, string] }): this {
    const d = this.doc
    const height = opts.height ?? 52
    if (this.y + height + 18 > BOTTOM) {
      d.addPage()
      this.y = MARGIN
    }
    const top = this.y
    const base = top + height
    const max = Math.max(1, ...opts.values, ...(opts.values2 ?? []))
    const n = opts.values.length
    const slot = CONTENT_W / Math.max(n, 1)
    const barW = Math.min(14, Math.max(3, slot * 0.32))
    const COLORS: Array<[number, number, number]> = [[18, 183, 106], [14, 165, 233]]
    opts.values.forEach((v, i) => {
      const series: Array<{ val: number; color: [number, number, number] }> = [{ val: v, color: COLORS[0] }]
      if (opts.values2) series.push({ val: opts.values2[i] ?? 0, color: COLORS[1] })
      series.forEach((s, j) => {
        const h = Math.max(v === 0 && s.val === 0 ? 0 : 0.8, (s.val / max) * height)
        const cx = MARGIN + slot * i + slot / 2 + (j - (series.length - 1) / 2) * (barW + 1.5)
        d.setFillColor(...s.color)
        d.rect(cx - barW / 2, base - h, barW, h, 'F')
        // Value label at the top of each bar (skip when bars are too crowded or the value is zero).
        if (slot >= 18 && s.val > 0 && h > 0) {
          d.setFont('helvetica', 'normal')
          d.setFontSize(6.5)
          d.setTextColor(...s.color)
          d.text(fmtCompact(s.val), cx, base - h - 1, { align: 'center' })
        }
      })
      const lab = opts.labels[i] ?? ''
      if (slot > 16 || i % Math.ceil(n / Math.max(1, Math.floor(CONTENT_W / 16))) === 0) {
        d.setFont('helvetica', 'normal')
        d.setFontSize(7)
        d.setTextColor(100, 116, 139)
        d.text(lab, MARGIN + slot * i + slot / 2, base + 4, { align: 'center' })
      }
    })
    // Baseline rule + max tick.
    d.setDrawColor(203, 213, 225)
    d.setLineWidth(0.3)
    d.line(MARGIN, base, MARGIN + CONTENT_W, base)
    d.setFont('helvetica', 'normal')
    d.setFontSize(7)
    d.setTextColor(100, 116, 139)
    d.text(fmtCompact(max), MARGIN + CONTENT_W, top + 2, { align: 'right' })
    d.text('0', MARGIN + CONTENT_W, base, { align: 'right' })
    this.y = base + 10
    if (opts.legend && opts.values2) {
      d.setFont('helvetica', 'normal')
      d.setFontSize(8)
      d.setTextColor(100, 116, 139)
      const [l1, l2] = opts.legend
      d.setFillColor(...COLORS[0])
      d.circle(MARGIN + 2, this.y - 1.2, 1.2, 'F')
      d.text(l1, MARGIN + 5, this.y)
      d.setFillColor(...COLORS[1])
      d.circle(MARGIN + 42, this.y - 1.2, 1.2, 'F')
      d.text(l2, MARGIN + 45, this.y)
      this.y += 6
    }
    return this
  }

  /** Horizontal proportional bars + amount labels (payment mix). */
  hBars(rows: { label: string; value: number; color: [number, number, number] }[]): this {
    const d = this.doc
    const rowH = 9
    const labelW = 52
    const valW = 30
    const barMax = CONTENT_W - labelW - valW - 4
    if (this.y + rows.length * rowH + 4 > BOTTOM) {
      d.addPage()
      this.y = MARGIN
    }
    const max = Math.max(1, ...rows.map((r) => r.value))
    rows.forEach((r) => {
      if (this.y + rowH > BOTTOM) {
        d.addPage()
        this.y = MARGIN
      }
      d.setFont('helvetica', 'normal')
      d.setFontSize(9)
      d.setTextColor(71, 85, 105)
      d.text(r.label, MARGIN, this.y + 4)
      const w = Math.max(1.5, (r.value / max) * barMax)
      d.setFillColor(...r.color)
      d.rect(MARGIN + labelW, this.y, w, 4.5, 'F')
      d.setFont('helvetica', 'bold')
      d.setFontSize(9)
      d.setTextColor(15, 23, 42)
      d.text(fmtCompact(r.value), MARGIN + labelW + barMax + 2, this.y + 4)
      this.y += rowH
    })
    this.y += 4
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

/** Compact axis/label money format: 1,500 → 1.5K · 2,000,000 → 2M (no "UGX"). */
function fmtCompact(v: number): string {
  const n = Number(v || 0)
  const trim = (x: number) => String(Number(x.toFixed(2)))
  if (Math.abs(n) >= 1_000_000) return `${trim((Math.round(n / 100) * 100) / 1_000_000)}M`
  if (Math.abs(n) >= 1_000) return `${trim((Math.round(n / 100) * 100) / 1_000)}K`
  return String(n)
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
