import { useMemo, useState } from 'react'
import { cartTotals, useCart } from '../store/cart'
import { PAYMENT_LABELS, type PaymentMethod } from '../lib/types'
import { ugx } from '../lib/format'

interface Props {
  totals: { subtotal: number; discount: number; total: number }
  onClose: () => void
  onComplete: (input: { discount: number; payment_method: PaymentMethod; amount_paid: number; customer_name: string | null; customer_phone: string | null }) => void
}

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank', 'card', 'credit']

export default function CheckoutModal({ totals, onClose, onComplete }: Props) {
  const cart = useCart()
  const [customerName, setCustomerName] = useState(cart.customer?.name || '')
  const [customerPhone, setCustomerPhone] = useState(cart.customer?.phone || '')
  const [discountInput, setDiscountInput] = useState(cart.discount ? String(cart.discount) : '')
  const [error, setError] = useState('')

  const parsedDiscount = Number(discountInput) || 0
  const finalTotals = useMemo(() => cartTotals(cart.items, parsedDiscount), [cart.items, parsedDiscount])

  const amountPaidNum = cart.paymentMethod === 'credit' ? 0 : Number(cart.amountPaid) || 0
  const changeDue = Math.max(0, amountPaidNum - finalTotals.total)
  const needsCustomer = cart.paymentMethod === 'credit' || customerPhone.length > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (cart.paymentMethod !== 'credit' && amountPaidNum < finalTotals.total) {
      setError(`Amount paid (${ugx(amountPaidNum)}) is less than total (${ugx(finalTotals.total)})`)
      return
    }
    if (cart.paymentMethod === 'credit' && !customerPhone.trim()) {
      setError('Credit sales require a customer phone number')
      return
    }

    onComplete({
      discount: parsedDiscount,
      payment_method: cart.paymentMethod,
      amount_paid: amountPaidNum,
      customer_name: customerName.trim() || (customerPhone.trim() ? 'Walk-in' : null),
      customer_phone: customerPhone.trim() || null,
    })
  }

  const quickCash = [finalTotals.total, 5000, 10000, 20000, 50000, 100000].filter((v, i, a) => v > 0 && a.indexOf(v) === i)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <form onSubmit={submit} className="relative card w-full max-w-md p-6 space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-lg">Checkout</h3>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Payment method */}
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1.5">Payment method</div>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => cart.setPaymentMethod(m)}
                className={cn2(
                  'px-2 py-2 rounded-lg text-xs font-semibold border transition',
                  cart.paymentMethod === m ? 'bg-brand-500/15 text-brand-300 border-brand-500/50' : 'text-slate-400 border-slate-800 hover:border-slate-600',
                )}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Discount */}
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1.5">{'Discount (UGX) — >5% needs manager approval'}</div>
          <input className="input" type="number" min={0} value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} placeholder="0" />
        </div>

        {/* Amount paid */}
        {cart.paymentMethod === 'credit' ? (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Credit sale — total of {ugx(finalTotals.total)} will be recorded as receivable and sent for approval.
          </div>
        ) : (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Amount paid</div>
            <input className="input text-lg font-bold" type="number" value={cart.amountPaid} onChange={(e) => cart.setAmountPaid(e.target.value)} placeholder={String(finalTotals.total)} />
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {quickCash.map((v) => (
                <button key={v} type="button" className="btn-ghost text-[11px] px-2 py-1" onClick={() => cart.setAmountPaid(String(v))}>
                  {v === finalTotals.total ? 'Exact' : ugx(v)}
                </button>
              ))}
            </div>
            {amountPaidNum > 0 && (
              <div className="flex justify-between text-sm mt-3 text-slate-400">
                <span>Change due</span><span className="text-brand-300 font-bold">{ugx(changeDue)}</span>
              </div>
            )}
          </div>
        )}

        {/* Customer */}
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="text-xs font-medium text-slate-400">Customer (optional — required for credit)</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" />
            <input className="input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone" />
          </div>
        </div>

        {/* Totals */}
        <div className="border-t border-slate-800 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{ugx(finalTotals.subtotal)}</span></div>
          {parsedDiscount > 0 && <div className="flex justify-between text-amber-300"><span>Discount</span><span>− {ugx(parsedDiscount)}</span></div>}
          <div className="flex justify-between text-xl font-bold text-white pt-1"><span>Total</span><span>{ugx(finalTotals.total)}</span></div>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

        <button className="btn-primary w-full text-base" disabled={cart.items.length === 0}>
          Complete sale · {ugx(finalTotals.total)}
        </button>
        {needsCustomer && cart.paymentMethod !== 'credit' && (
          <p className="text-[11px] text-slate-600 text-center">Customer info is optional for paid sales.</p>
        )}
      </form>
    </div>
  )
}

function cn2(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}
