import { useLiveQuery } from 'dexie-react-hooks'
import { getRecentSales } from '../db/repos'
import { PAYMENT_LABELS, type LocalSale, type LocalSaleItem } from '../lib/types'
import { ugx } from '../lib/format'
import { db } from '../db/database'
import { useState } from 'react'

export default function HistoryModal({ onClose }: { onClose: () => void }) {
  const sales = useLiveQuery(() => getRecentSales(100), [])
  const [detail, setDetail] = useState<string | null>(null)
  const items = useLiveQuery(async () => (detail ? db.saleItems.where('sale_id').equals(detail).toArray() : []), [detail])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-md h-full bg-[#111814] border-l border-slate-800 p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-white">Sales history (this terminal)</h3>
          <button className="text-slate-500 hover:text-white text-xl" onClick={onClose}>×</button>
        </div>

        {!sales ? (
          <div className="text-sm text-slate-600">Loading…</div>
        ) : sales.length === 0 ? (
          <div className="text-sm text-slate-600 py-10 text-center">No sales on this terminal yet.</div>
        ) : (
          <div className="space-y-2">
            {sales.map((s: LocalSale) => (
              <div key={s.id} className="card p-3">
                <button className="w-full text-left" onClick={() => setDetail(detail === s.id ? null : s.id)}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-brand-300">{s.server_receipt_no || s.receipt_no}</span>
                    <span className="font-bold text-white">{ugx(s.total)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                    <span>{new Date(s.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {PAYMENT_LABELS[s.payment_method]}</span>
                    <span className={s.status === 'synced' ? 'text-brand-400' : 'text-amber-400'}>
                      {s.status === 'synced' ? '✓ synced' : `⏳ queued (${s.attempts || 0} tries)`}
                    </span>
                  </div>
                </button>

                {detail === s.id && (
                  <div className="border-t border-slate-800 mt-2 pt-2 space-y-1">
                    {(items || []).map((it: LocalSaleItem) => (
                      <div key={it.id} className="flex justify-between text-xs text-slate-400">
                        <span>{it.qty} × {it.name}</span>
                        <span>{ugx(it.line_total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
