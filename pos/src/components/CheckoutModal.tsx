import { useMemo, useState, useEffect } from 'react'
import { cartTotals, useCart } from '../store/cart'
import { PAYMENT_LABELS, type PaymentMethod } from '../lib/types'
import { ugx } from '../lib/format'
import { getCustomers } from '../db/repos'
import type { Customer } from '../lib/types'

interface Props {
  totals: { subtotal: number; total: number }
  onClose: () => void
  onComplete: (input: { payment_method: PaymentMethod; amount_paid: number; customer_name: string | null; customer_phone: string | null }) => void
}

const METHODS: PaymentMethod[] = ['cash', 'mobile_money', 'bank', 'card', 'credit']

export default function CheckoutModal({ totals, onClose, onComplete }: Props) {
  const cart = useCart()
  const [customerName, setCustomerName] = useState(cart.customer?.name || '')
  const [customerPhone, setCustomerPhone] = useState(cart.customer?.phone || '')
  const [registered, setRegistered] = useState(false)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    getCustomers().then(setCustomers).catch(() => setCustomers([]))
  }, [])

  // Discounts are admin-only: there is intentionally no discount field on this
  // screen. The POS always checks out at full price and any hand-crafted payload
  // carrying a discount is refused server-side, exactly like a credit sale.
  const finalTotals = useMemo(() => cartTotals(cart.items), [cart.items])

  function selectCustomer(id: string | null) {
    setCustomerId(id)
    if (id) {
      const c = customers.find((c) => c.id === id)
      if (c) {
        setCustomerName(c.full_name)
        setCustomerPhone(c.phone || '')
      }
    }
  }

  // Exact-payment checkout: non-credit methods always pay the full total.
  // Down payments / installments are handled by the reservation flow, never here.
  const amountPaidNum = cart.paymentMethod === 'credit' ? 0 : finalTotals.total
  const hasBike = cart.items.some((i) => i.kind === 'bike')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (cart.paymentMethod === 'credit' && !customerPhone.trim()) {
      setError('Credit sales require a customer phone number')
      return
    }
    if (hasBike && (!customerName.trim() || !customerPhone.trim())) {
      setError('E-Bike sales require the customer name and phone number')
      return
    }
    if (registered && customerId === null && (!customerName.trim() || !customerPhone.trim())) {
      setError('Select a registered customer or enter their name and phone number')
      return
    }

    // Only attach the order to a customer record when the cashier marked the
    // buyer as registered (or the sale forces identity: bike / credit). The
    // server links the sale to the customer by phone automatically.
    const track = registered || hasBike || cart.paymentMethod === 'credit'
    // No discount field and no discount payload: only an admin can issue one.
    onComplete({
      payment_method: cart.paymentMethod,
      amount_paid: amountPaidNum,
      customer_name: track ? customerName.trim() || 'Walk-in' : null,
      customer_phone: track ? customerPhone.trim() || null : null,
    })
  }

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

        {/* Amount due */}
        {cart.paymentMethod === 'credit' ? (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Credit sale — total of {ugx(finalTotals.total)} will be recorded as receivable and sent for approval.
          </div>
        ) : (
          <div>
            <div className="text-xs font-medium text-slate-400 mb-1.5">Amount due</div>
            <div className="rounded-lg border border-slate-800 bg-[#0b0e13] px-3 py-2.5 text-lg font-bold text-white">
              {ugx(finalTotals.total)}
            </div>
            <p className="text-[11px] text-slate-600 mt-1.5">Exact payment — no change due. For a down payment / installment plan, use Reserve instead.</p>
          </div>
        )}

        {/* Customer */}
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="text-xs font-medium text-slate-400">Customer {hasBike ? '(required — E-Bike in cart)' : '(optional — required for credit)'}</div>

          {/* Registered customer radio — Walk-in is the default (unchecked) */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="customer-type"
              checked={registered}
              onClick={() => {
                const next = !registered
                setRegistered(next)
                setCustomerId(null)
                if (!next) {
                  setCustomerName('')
                  setCustomerPhone('')
                }
              }}
              className="w-4 h-4 text-brand-500 border-slate-600 focus:ring-brand-500 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition">Registered customer</span>
          </label>

          {registered && (
            <p className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2">
              This order will be added to the customer&apos;s record and tracked in their purchase history.
            </p>
          )}

          {/* Customer selection: dropdown for registered, name+phone fields for walk-in */}
          {registered ? (
            <select
              className="input w-full"
              value={customerId || ''}
              onChange={(e) => selectCustomer(e.target.value || null)}
              aria-label="Select a registered customer"
            >
              <option value="">— Select a registered customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} — {c.phone || 'No phone'}
                </option>
              ))}
            </select>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Name"
                required={hasBike || cart.paymentMethod === 'credit'}
              />
              <input
                className="input"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone"
                required={hasBike || cart.paymentMethod === 'credit'}
              />
            </div>
          )}
        </div>

        {/* Totals — POS always checks out at full price (discount 0). Only an
            admin can approve and issue discounts, exactly like credit sales,
            so there is no discount field on this screen. */}
        <div className="border-t border-slate-800 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-slate-400"><span>Subtotal</span><span>{ugx(finalTotals.subtotal)}</span></div>
          <div className="flex justify-between text-xl font-bold text-white pt-1"><span>Total</span><span>{ugx(finalTotals.total)}</span></div>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

        <button
          className={cn2(
            'btn w-full text-base',
            // Credit = a request, not a completed sale — orange to signal the
            // approval step ahead (stock & debt only move after Finalize).
            cart.paymentMethod === 'credit'
              ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
              : 'bg-brand-500 text-[#06210f] hover:bg-brand-400',
          )}
          disabled={cart.items.length === 0}
        >
          {cart.paymentMethod === 'credit' ? 'Request Approval' : 'Complete sale'} · {ugx(finalTotals.total)}
        </button>
        {cart.paymentMethod !== 'credit' && (
          <p className="text-[11px] text-slate-600 text-center">
            {hasBike ? 'Customer name + phone are required for E-Bike sales.' : 'Customer info is optional for paid sales.'}
          </p>
        )}
      </form>
    </div>
  )
}

function cn2(...c: (string | false | undefined | null)[]) {
  return c.filter(Boolean).join(' ')
}
