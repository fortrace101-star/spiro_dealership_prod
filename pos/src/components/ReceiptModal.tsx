import { getSaleWithItems } from '../db/repos'
import type { LocalSale, LocalSaleItem } from '../lib/types'
import { ugx } from '../lib/format'
import { PAYMENT_LABELS } from '../lib/types'
import { useEffect, useState } from 'react'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

// Build receipt HTML as a reusable function
function buildReceiptHTML(
  sale: LocalSale,
  items: LocalSaleItem[],
  displayReceipt: string,
): string {
  return `
    <html>
      <head><title>${displayReceipt}</title>
        <style>
          body { font-family: monospace; padding: 16px; font-size: 12px; }
          h2 { margin: 0 0 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          td { padding: 2px 0; }
          .r { text-align: right; }
          .muted { color: #555; }
          hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
        </style>
      </head>
      <body>
        <h2>SPIRO E-BIKES & PARTS</h2>
        <div class="muted">Kampala, Uganda · +256 700 000 000</div>
        <hr/>
        <div>Receipt: <b>${displayReceipt}</b></div>
        <div class="muted">${new Date(sale.created_at).toLocaleString()} · ${sale.cashier_name} · ${sale.device_id}</div>
        ${sale.customer_name ? `<div class="muted">Customer: ${sale.customer_name}${sale.customer_phone ? ` (${sale.customer_phone})` : ''}</div>` : ''}
        <hr/>
        <table>
          ${items
            .map(
              (i) =>
                `<tr><td>${i.name}<br/><span class="muted">${i.qty} × ${ugx(i.unit_price)}</span></td><td class="r">${ugx(i.line_total)}</td></tr>`,
            )
            .join('')}
        </table>
        <hr/>
        <table>
          <tr><td>Subtotal</td><td class="r">${ugx(sale.subtotal)}</td></tr>
          ${sale.discount > 0 ? `<tr><td>Discount</td><td class="r">− ${ugx(sale.discount)}</td></tr>` : ''}
          <tr><td><b>TOTAL</b></td><td class="r"><b>${ugx(sale.total)}</b></td></tr>
          <tr><td>Paid (${PAYMENT_LABELS[sale.payment_method]})</td><td class="r">${ugx(sale.amount_paid)}</td></tr>
          ${sale.change_due > 0 ? `<tr><td>Change</td><td class="r">${ugx(sale.change_due)}</td></tr>` : ''}
        </table>
        <hr/>
        <div class="muted" style="text-align:center">Asante sana! 🛵 Warranty at receipt presentation.</div>
        ${sale.status === 'pending_sync' ? '<div class="muted" style="text-align:center">[Recorded offline — will sync]</div>' : ''}
      </body>
    </html>
  `
}

// Render receipt to an off-screen container, then convert to canvas/JPG blob
async function exportReceiptAsImage(sale: LocalSale, items: LocalSaleItem[], displayReceipt: string) {
  const html = buildReceiptHTML(sale, items, displayReceipt)
  const container = document.createElement('div')
  container.innerHTML = html
  Object.assign(container.style, {
    position: 'absolute',
    left: '-9999px',
    width: '380px',
    background: '#fff',
  })
  document.body.appendChild(container)
  await new Promise((r) => (container.onload = container.onerror = r))

  const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#fff' })
  document.body.removeChild(container)

  // JPG export
  const jpgUrl = canvas.toDataURL('image/jpeg', 0.9)
  const link = document.createElement('a')
  link.href = jpgUrl
  link.download = `receipt-${displayReceipt}.jpg`
  link.click()

  return canvas
}

// PDF export: use the canvas rendered above and embed as image in A4
async function exportReceiptAsPDF(canvas: any, displayReceipt: string) {
  const imgData = canvas.toDataURL('image/jpeg', 0.9)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt' })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const imgProps = pdf.getImageProperties(imgData)
  const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height, 1)
  const imgWidth = imgProps.width * ratio
  const imgHeight = imgProps.height * ratio
  pdf.addImage(imgData, 'JPEG', (pageWidth - imgWidth) / 2, 10, imgWidth, imgHeight)
  pdf.save(`receipt-${displayReceipt}.pdf`)
}

export default function ReceiptModal({ sale, onClose }: { sale: LocalSale; onClose: () => void }) {
  const [items, setItems] = useState<LocalSaleItem[]>([])

  useEffect(() => {
    getSaleWithItems(sale.id).then(([, items]) => setItems(items))
  }, [sale.id])

  const displayReceipt = sale.server_receipt_no || sale.receipt_no

    async function handlePrint() {
    // Trigger JPG and PDF downloads
    try {
      const canvas = await exportReceiptAsImage(sale, items, displayReceipt)
      await exportReceiptAsPDF(canvas, displayReceipt)
    } catch (err) {
      console.error('[receipt] export failed:', err)
      alert('Export failed — see browser console.')
    }
    
    // Then open print dialog
    const w = window.open('', 'PRINT', 'height=600,width=400')
    if (!w) return
    w.document.write(buildReceiptHTML(sale, items, displayReceipt))
    w.document.close()
    w.focus()
    w.print()
    w.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="mx-auto h-14 w-14 rounded-full bg-brand-500/15 border border-brand-500/40 flex items-center justify-center text-2xl mb-3">
            ✓
          </div>
          <h3 className="font-bold text-white text-lg">Sale completed</h3>
          <p className="text-xs text-slate-500 mt-1">
            {sale.status === 'pending_sync' ? 'Saved offline — will sync automatically' : 'Synced to server'}
          </p>
        </div>

        <div className="bg-[#0c1210] rounded-xl border border-slate-800 p-4 text-sm space-y-1.5 mb-5">
          <div className="flex justify-between text-slate-400"><span>Receipt</span><span className="font-mono text-brand-300">{displayReceipt}</span></div>
          <div className="flex justify-between text-slate-400"><span>Total</span><span className="font-bold text-white">{ugx(sale.total)}</span></div>
          {sale.payment_method !== 'credit' && sale.amount_paid > 0 && (
            <div className="flex justify-between text-slate-400"><span>Change due</span><span className="text-brand-300 font-bold">{ugx(sale.change_due)}</span></div>
          )}
          <div className="flex justify-between text-slate-400"><span>Payment</span><span>{PAYMENT_LABELS[sale.payment_method]}</span></div>
        </div>

                <div className="flex gap-2 flex-col sm:flex-row">
          <button className="btn-ghost flex-1" onClick={handlePrint}>🖨 Print receipt</button>
          <button className="btn-primary flex-1" onClick={onClose}>New sale</button>
        </div>
      </div>
    </div>
  )
}
