// Shared API types (matching server responses)

export interface ServiceJobCard {
  id: string
  bike_id: string
  customer_id: string | null
  bike?: BikeMini
  customer_name?: string | null
  mileage_km: number
  issue: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  assigned_to?: string | null
  assigned_to_name?: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  created_by: string
  created_by_name?: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  notes: string | null
  activities?: ServiceActivity[]
  total_parts_cost: number
  total_labour_cost: number
  total_cost: number
}

export interface ServiceActivity {
  id: string
  job_card_id: string
  type: 'inspection' | 'battery_inspection' | 'battery_repair' | 'battery_replacement' | 'motor_inspection' | 'motor_repair' | 'motor_replacement' | 'brake_replacement' | 'suspension' | 'tire_repair' | 'electrical' | 'part_replacement' | 'labour' | 'other'
  description: string
  parts_used: ServicePartUsed[]
  labour_cost: number
  total_cost: number
  performed_by: string | null
  performed_by_name?: string | null
  performed_at: string
  notes: string | null
}

export interface ServicePartUsed {
  name: string
  qty: number
  unit_cost: number
}

export interface ServiceHistorySummary {
  job_cards_count: number
  total_spent: number
  last_service_at: string | null
}

export interface BikeMini {
  id: string
  vin: string
  model: string
  status: string
}

/**
 * Dashboard roles. Mirrors the server catalog (`server/src/permissions/catalog.js`):
 * `cashier` (pre-rename) and `mechanic` (removed) are normalized to `operator`
 * server-side, so they must never be written again.
 */
export type Role = 'admin' | 'manager' | 'operator'

/**
 * Extra POS capabilities that can be granted on an activation code / to a user,
 * beyond what their role already holds. Ids are the *grantable* entries of the
 * server catalog — the admin can tick these to let one trusted operator do
 * manager-only work (receiving, reservations, installments) without promoting
 * them. `inventory_entry` is the legacy alias stored on older rows; the server
 * expands it to inventory_receive + reorder_manage. `product_create` was
 * folded into inventory_receive (receiving is all-or-nothing) and is dropped
 * from stored grants on the next save.
 */
export type PosPermission =
  | 'inventory_entry' // legacy alias — expands to the two stock grants below
  | 'inventory_receive'
  | 'reorder_create'
  | 'reorder_manage'
  | 'credit_request'
  | 'credit_finalize'
  | 'credit_settle'
  | 'installment_collect'
      | 'reservation_create'
  | 'reservation_complete'
  | 'reservation_release'
  | 'product_edit'
  | 'inventory_adjust'

export interface User {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: Role
  permissions?: PosPermission[]
  is_active: boolean
  last_login_at?: string
  created_at?: string
}

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  category: string
  brand: string | null
  supplier: string | null
  cost_price: string | number
  selling_price: string | number
  stock_qty: number
  min_stock: number
  reorder_level: number
  stock_value?: string | number
  active: boolean
  updated_at: string
}

export interface Bike {
  id: string
  vin: string
  model: string
  color: string | null
  year: number | null
  motor_number: string | null
  battery_serial: string | null
  battery_spec: string | null
  odometer_km: number
  cost_price: string | number
  selling_price: string | number
  status: 'in_stock' | 'reserved' | 'sold'
  location: string | null
  received_at: string
  sold_at: string | null
  sold_price: string | number | null
  customer_id: string | null
  customer_name?: string | null
  customer_phone?: string | null
  updated_at?: string
}

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  purchase_count?: number
  lifetime_value?: string | number
}

export interface Sale {
  id: string
  receipt_no: string
  subtotal: string | number
  discount: string | number
  total: string | number
  profit: string | number
  payment_method: 'cash' | 'mobile_money' | 'bank' | 'card' | 'credit'
  status: string
  created_at: string
  cashier_id?: string
  cashier_name?: string
  customer_id?: string | null
  customer_name?: string | null
  device_id?: string | null
  client_txn_id?: string
  bike_vin?: string | null
  bike_model?: string | null
  /** Latest credit-sale decision ('approved' | 'rejected'), when any — used for the Approved/Rejected pills. */
  approval_status?: 'approved' | 'rejected' | null
}

export interface CustomerBikeLink {
  id: string
  bike_id: string | null
  external_desc: string | null
  plate: string | null
  vin: string | null
  model: string | null
  color: string | null
  status: string | null
}

export interface SaleItem {
  id: string
  sale_id: string
  product_id: string | null
  bike_id: string | null
  name: string
  kind: 'part' | 'bike'
  qty: number
  unit_price: string | number
  unit_cost: string | number
  line_total: string | number
}

export interface ActivationCode {
  id: string
  code: string
  label: string | null
  role: Role
  permissions?: PosPermission[]
  created_by_name?: string | null
  claimed_by_name?: string | null
  used_at: string | null
  expires_at: string
  created_at: string
}

export interface Approval {
  id: string
  type: 'discount' | 'stock_adjustment' | 'credit_sale' | 'refund' | 'reservation_release'
  requested_by_name?: string | null
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  decided_by_name?: string | null
  decided_at: string | null
  note: string | null
  created_at: string
}

export interface AuditEntry {
  id: number
  user_name: string | null
  user_role: string | null
  action: string
  entity: string
  entity_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  meta: Record<string, unknown> | null
  created_at: string
}

export interface StockMovement {
  id: string
  product_id: string
  product_name: string
  sku: string
  qty: number
  type: string
  user_name: string | null
  note: string | null
  client_txn_id: string | null
  created_at: string
}

export interface CreditPayment {
  id: string
  amount: string | number
  payment_method: string
  note: string | null
  created_at: string
}

export interface CreditLedgerItem {
  id: string
  name: string
  kind: 'part' | 'bike'
  qty: number
  unit_price: string | number
  line_total: string | number
}

export interface CreditLedgerSale {
  id: string
  receipt_no: string
  total: string | number
  created_at: string
  status: string
  customer_name: string | null
  customer_phone: string | null
  cashier_name: string | null
  paid: string | number
  balance: string | number
  approval_status: 'pending' | 'approved' | 'rejected' | null
  payments: CreditPayment[]
  items: CreditLedgerItem[]
}

export interface ReservationToday {
  new_count: number
  new_down_payments: number
  payments_count: number
  payments_amount: number
  collected_today: number
  completed_count: number
  new_today: {
    id: string
    down_payment: string | number
    total_price: string | number
    balance: string | number
    plan_months: number
    reserved_at: string
    customer_name: string
    phone: string | null
    model: string
    vin: string
    reserved_by_name: string | null
  }[]
  payments_today: {
    id: string
    reservation_id: string
    amount: string | number
    payment_method: string
    created_at: string
    customer_name: string
    model: string
    vin: string
  }[]
  completed_today: {
    id: string
    total_price: string | number
    completed_at: string
    customer_name: string
    model: string
    vin: string
  }[]
}

export interface TodayReport {
  today: {
    sales_count: number
    revenue: number
    profit: number
    avg_transaction: number
    discounts: number
    bikes_sold: number
    low_stock_count: number
    pending_approvals: number
    pending_sync: number
    credit_outstanding: number
    credit_pending: number
    settlement_revenue: number
    settlement_profit: number
  }
  // Option B accounting: reservation money is isolated here — never folded
  // into revenue/profit above (a reservation is not a sale yet).
  reservations: ReservationToday
  payments: { payment_method: string; amount: string | number; n: number }[]
  items: { kind: string; amount: string | number; qty: string | number }[]
}

export interface HourlyPoint {
  hour: number
  revenue: number
  profit: number
}

export interface RangeReport {
  kpi: {
    sales_count: number
    revenue: number
    profit: number
    avg_transaction: number
    bikes_sold: number
    parts_sold: number
    credit_outstanding: number
    stock_value: number
  }
  daily: { day: string; revenue: string | number; profit: string | number }[]
}

export interface PurchasingListItem {
  product_id: string | null
  sku: string
  name: string
  qty: number
  unit_cost?: number
  reorder_level?: number
  new_product?: {
    sku: string
    name: string
    barcode: string
    category: string
    selling_price: number
    min_stock: number
    reorder_level: number
  }
}

export interface PurchasingRecord {
  id: string
  client_txn_id: string
  reference?: string
  title?: string
  supplier?: string | null
  delivery_cost?: string | number
  items_total?: string | number
  items: PurchasingListItem[]
  notes: string | null
  created_by_name?: string
  source_list_id?: string | null
  source_list_title?: string | null
  created_at: string
  status?: string
}

export interface VinLookupResult {
  bike: Bike
  sales: { id: string; receipt_no: string; total: string | number; created_at: string; cashier: string }[]
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
  reserved_by: string
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
  bike?: BikeMini & { selling_price?: number | string }
  customer?: { id: string; full_name: string; phone: string | null; email?: string | null; address?: string | null; notes?: string | null }
  reservations_payments?: InstallmentPayment[]
}
