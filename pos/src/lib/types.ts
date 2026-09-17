export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  category: string
  brand: string | null
  selling_price: number
  cost_price: number
  stock_qty: number
  min_stock: number
  reorder_level: number
  active?: boolean
  updated_at: string
}

export interface Bike {
  id: string
  vin: string
  model: string
  color: string | null
  year: number | null
  selling_price: number
  cost_price: number
  battery_serial: string | null
  battery_spec: string | null
  status: string
  updated_at: string
}

export type PaymentMethod = 'cash' | 'mobile_money' | 'bank' | 'card' | 'credit'

export interface CartItem {
  key: string // product_id or bike_id
  kind: 'part' | 'bike'
  id: string // product or bike id
  name: string
  sku?: string
  unit_price: number
  unit_cost: number
  qty: number
  stock_qty: number // snapshot at add time (may be stale offline)
}

export interface CartCustomer {
  name: string
  phone: string
}

export interface LocalSaleItem {
  id?: number
  sale_id: string
  product_id: string | null
  bike_id: string | null
  name: string
  kind: 'part' | 'bike'
  qty: number
  unit_price: number
  unit_cost: number
  line_total: number
}

export interface LocalSale {
  id: string // uuid = client_txn_id basis
  client_txn_id: string
  receipt_no: string // local temp until server assigns
  server_receipt_no?: string | null
  cashier_id: string
  cashier_name: string
  device_id: string
  customer_name: string | null
  customer_phone: string | null
  subtotal: number
  discount: number
  total: number
  payment_method: PaymentMethod
  amount_paid: number
  change_due: number
  status: 'pending_sync' | 'synced'
  attempts: number
  created_at: string
  synced_at: string | null
}

export interface SessionUser {
  id: string
  full_name: string
  role: string
  permissions?: string[]
}

export interface SyncQueueEntry {
  queueId?: number
  entity: 'sale'
  entityId: string
  operation: 'create'
  status: 'pending' | 'done' | 'failed'
  createdAt: string
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank: 'Bank',
  card: 'Card',
  credit: 'Credit',
}
