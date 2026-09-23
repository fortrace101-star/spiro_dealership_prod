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

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
}

export interface SessionUser {
  id: string
  full_name: string
  role: string
  permissions?: string[]
}

export interface ReservationBikeMini {
  id: string
  vin: string
  model: string
  color: string | null
  status: string
  selling_price: number
}

export interface ReservationCustomerMini {
  id: string
  full_name: string
  phone: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

export interface InstallmentPayment {
  id: string
  reservation_id: string
  amount: number
  payment_method: string
  paid_by: string | null
  paid_by_name?: string | null
  transaction_ref: string | null
  note: string | null
  created_at: string
}

export interface BikeReservation {
  id: string
  bike_id: string
  customer_id: string
  reserved_by: string | null
  reserved_by_name?: string | null
  reserved_at: string
  total_price: number
  down_payment: number
  balance: number
  plan_months: number
  status: 'active' | 'completed' | 'released' | 'expired'
  notes: string | null
  completed_at: string | null
  released_at: string | null
  created_at: string
  updated_at: string
  bike?: ReservationBikeMini
  customer?: ReservationCustomerMini
  reservations_payments?: InstallmentPayment[]
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

/** Credit-sale row from GET /api/pos/credit-sales (pending queue, this cashier). */
export interface CreditPendingSale {
  id: string
  receipt_no: string
  total: string | number
  created_at: string
  status: string // 'pending_credit' until Finalize flips it to 'completed'
  customer_name: string | null
  customer_phone: string | null
  approval_status: 'pending' | 'approved' | 'rejected' | null
}

/** Outsettled-debt row from GET /api/pos/credit-sales (completed, balance > 0). */
export interface CreditOutstandingSale {
  id: string
  receipt_no: string
  total: string | number
  created_at: string
  customer_name: string | null
  customer_phone: string | null
  paid: string | number
  balance: string | number
}

/** Decision event from GET /api/pos/credit-status (POS bell polling fallback). */
export interface CreditDecision {
  sale_id: string
  receipt_no: string
  decision: 'approved' | 'rejected'
  decided_at: string
}
