import { getSaleWithItems } from '../db/repos'
import type { LocalSale, LocalSaleItem } from '../lib/types'
import { ugx } from '../lib/format'
import { PAYMENT_LABELS } from '../lib/types'
import { useEffect, useState } from 'react'
import { saveReceiptPdf } from '../lib/pdf'

// Native vector PDF receipt (80mm thermal-style) — no html2canvas raster
// step, so it can't blank out on iOS and stays crisp at any zoom. This is the
// only receipt path: the old plain-HTML "browser print" window is gone.
async function exportReceiptPDF(sale: LocalSale, items: LocalSaleItem[], displayReceipt: string) {
  saveReceiptPdf(
    {
      receiptNo: displayReceipt,
      createdAt: new Date(sale.created_at).toLocaleString(),
      cashier: sale.cashier_name,
      device: sale.device_id,
      customerName: sale.customer_name,
      customerPhone: sale.customer_phone,
      items: items.map((i) => ({ name: i.name, qty: i.qty, unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      total: Number(sale.total),
      paymentLabel: PAYMENT_LABELS[sale.payment_method] || sale.payment_method,
      amountPaid: Number(sale.amount_paid),
      changeDue: Number(sale.change_due),
      awaitingApproval: sale.payment_method === 'credit',
      pendingSync: sale.status === 'pending_sync',
      fmt: ugx,
    },
    `receipt-${displayReceipt}.pdf`,
  )
}

export default function ReceiptModal({ sale, onClose }: { sale: LocalSale; onClose: () => void }) {
  const [items, setItems] = useState<LocalSaleItem[]>([])

  useEffect(() => {
    getSaleWithItems(sale.id).then(([, items]) => setItems(items))
  }, [sale.id])

  const displayReceipt = sale.server_receipt_no || sale.receipt_no

  // Receipt action (grey, left): downloads the vector PDF receipt.
  async function handlePrint() {
    try {
      exportReceiptPDF(sale, items, displayReceipt)
    } catch (err) {
      console.error('[receipt] PDF export failed:', err)
      alert('Export failed — see browser console.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="mx-auto h-14 w-14 rounded-full bg-brand-500/15 border border-brand-500/40 flex items-center justify-center text-2xl mb-3">
            ✓
          </div>
          <h3 className="font-bold text-white text-lg">
            {sale.payment_method === 'credit' ? 'Sent for approval' : 'Sale completed'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {sale.payment_method === 'credit'
              ? 'Nothing recorded yet — stock and debt move only after approval + Finalize'
              : sale.status === 'pending_sync'
                ? 'Saved offline — will sync automatically'
                : 'Synced to server'}
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

        {/* Print receipt (secondary, left) and New sale (primary, right) share
            one row — the two buttons swap both slot and colour, so the orange
            stays on the right as the action that moves the cashier on. Phones
            stack with `flex-col` (Print receipt on top), which is the same
            order as the previous build. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-ghost flex-1" onClick={() => void handlePrint()}>🖨 Print receipt</button>
          <button className="btn-primary flex-1" onClick={onClose}>New sale</button>
        </div>
      </div>
    </div>
  )
}
