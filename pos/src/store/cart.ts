import { create } from 'zustand'
import type { CartCustomer, CartItem, PaymentMethod } from '../lib/types'

interface CartState {
  items: CartItem[]
  customer: CartCustomer | null
  paymentMethod: PaymentMethod
  amountPaid: string
  lastReceipt: { id: string; total: number; change_due: number; receipt_no: string } | null

  addItem: (item: Omit<CartItem, 'key' | 'qty'>, qty?: number) => void
  setQty: (key: string, qty: number) => void
  removeItem: (key: string) => void
  clearCart: () => void
  setCustomer: (c: CartCustomer | null) => void
  setPaymentMethod: (m: PaymentMethod) => void
  setAmountPaid: (v: string) => void
  setLastReceipt: (r: { id: string; total: number; change_due: number; receipt_no: string } | null) => void
}

export const useCart = create<CartState>((set) => ({
  items: [],
  customer: null,
  paymentMethod: 'cash',
  amountPaid: '',
  lastReceipt: null,

  addItem: (item, qty = 1) =>
    set((state) => {
      const key = item.kind === 'bike' ? `bike:${item.id}` : `prod:${item.id}`
      const existing = state.items.find((i) => i.key === key)
      const stockCap = item.kind === 'bike' ? 1 : item.stock_qty
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.key === key ? { ...i, qty: Math.min(i.qty + qty, Math.max(stockCap, 1)) } : i,
          ),
        }
      }
      return {
        items: [...state.items, { ...item, key, qty: Math.min(qty, Math.max(stockCap, 1)) }],
      }
    }),

  setQty: (key, qty) =>
    set((state) => ({
      items:
        qty <= 0
          ? state.items.filter((i) => i.key !== key)
          : state.items.map((i) => (i.key === key ? { ...i, qty } : i)),
    })),

  removeItem: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),
  clearCart: () => set({ items: [], amountPaid: '', customer: null, lastReceipt: null }),
  setCustomer: (customer) => set({ customer }),
  setPaymentMethod: (m) => set({ paymentMethod: m }),
  setAmountPaid: (v) => set({ amountPaid: v }),
  setLastReceipt: (r) => set({ lastReceipt: r }),
}))

/**
 * Cart totals. There is no discount parameter on purpose: discounts are issued
 * and approved by the administrator only, so the POS always prices at full
 * value (any discount payload is refused server-side).
 */
export function cartTotals(items: CartItem[]) {
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.qty, 0)
  return { subtotal, total: subtotal }
}
