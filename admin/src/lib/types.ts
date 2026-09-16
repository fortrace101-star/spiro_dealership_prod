// Shared API types (matching server responses)

export type Role = 'admin' | 'manager' | 'cashier' | 'mechanic'

export interface User {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: Role
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
  created_by_name?: string | null
  claimed_by_name?: string | null
  used_at: string | null
  expires_at: string
  created_at: string
}

export interface Approval {
  id: string
  type: 'discount' | 'stock_adjustment' | 'credit_sale' | 'refund'
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
  }
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

export interface VinLookupResult {
  bike: Bike
  sales: { id: string; receipt_no: string; total: string | number; created_at: string; cashier: string }[]
}
