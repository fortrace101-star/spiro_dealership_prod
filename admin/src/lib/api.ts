import type {
  ActivationCode, Approval, AuditEntry, Bike, Customer, CustomerBikeLink, Product, PurchasingRecord, RangeReport,
  Sale, SaleItem, StockMovement, TodayReport, HourlyPoint, User, VinLookupResult,
} from './types'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '')
const TOKEN_KEY = 'spiro_admin_token'
const USER_KEY = 'spiro_admin_user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setSession(token: string, user: unknown) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function getStoredUser(): unknown | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `Request failed (${res.status})`
    if (res.status === 401) clearSession()
    throw new ApiError(msg, res.status)
  }
  return body as T
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request<{ user: User }>('/api/auth/me'),
  changePassword: (current: string, next: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current, next }) }),

  // reports — window helpers accept preset days OR explicit from/to ISO dates
  today: () => request<TodayReport>('/api/reports/today'),
  hourly: () => request<{ series: HourlyPoint[] }>('/api/reports/today/hourly'),
  range: (days: number, opts?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams()
    if (opts?.from && opts?.to) {
      qs.set('from', opts.from)
      qs.set('to', opts.to)
    } else {
      qs.set('days', String(days))
    }
    return request<RangeReport>(`/api/reports/range?${qs.toString()}`)
  },
  topProducts: (days = 30, order = 'revenue', opts?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams({ order })
    if (opts?.from && opts?.to) {
      qs.set('from', opts.from)
      qs.set('to', opts.to)
    } else {
      qs.set('days', String(days))
    }
    return request<{ products: { name: string; qty: number; revenue: string | number; profit: string | number }[] }>(
      `/api/reports/top-products?${qs.toString()}`,
    )
  },
  payments: (days = 30, opts?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams()
    if (opts?.from && opts?.to) {
      qs.set('from', opts.from)
      qs.set('to', opts.to)
    } else {
      qs.set('days', String(days))
    }
    return request<{ payments: { payment_method: string; amount: string | number }[] }>(`/api/reports/payments?${qs.toString()}`)
  },
  cashiers: (days = 30, opts?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams()
    if (opts?.from && opts?.to) {
      qs.set('from', opts.from)
      qs.set('to', opts.to)
    } else {
      qs.set('days', String(days))
    }
    return request<{ cashiers: { id: string; full_name: string; sales_count: number; revenue: string | number; profit: string | number; discounts: string | number }[] }>(
      `/api/reports/cashiers?${qs.toString()}`,
    )
  },
  lowStock: () => request<{ products: Product[] }>('/api/reports/low-stock'),

  // sales
  sales: (params = '') => request<{ sales: Sale[] }>(`/api/admin/sales?${params}`),
  sale: (id: string) => request<{ sale: Sale; items: SaleItem[] }>(`/api/admin/sales/${id}`),

  // inventory
  products: (q = '', lowStock = false) =>
    request<{ products: Product[] }>(`/api/admin/products?q=${encodeURIComponent(q)}${lowStock ? '&low_stock=1' : ''}`),
  createProduct: (p: Partial<Product>) => request<{ product: Product }>('/api/admin/products', { method: 'POST', body: JSON.stringify(p) }),
  updateProduct: (id: string, p: Partial<Product>) => request<{ product: Product }>(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  bikes: (q = '', status = '') => request<{ bikes: Bike[] }>(`/api/admin/bikes?q=${encodeURIComponent(q)}&status=${status}`),
  createBike: (b: Partial<Bike>) => request<{ bike: Bike }>('/api/admin/bikes', { method: 'POST', body: JSON.stringify(b) }),
  updateBike: (id: string, b: Partial<Bike>) => request<{ bike: Bike }>(`/api/admin/bikes/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  vinLookup: (vin: string) => request<VinLookupResult>(`/api/admin/bikes/lookup/${encodeURIComponent(vin)}`),
  adjustStock: (product_id: string, qty: number, note: string, type = 'adjustment') =>
    request<{ movement: StockMovement; stock_qty: number }>('/api/admin/inventory/adjust', { method: 'POST', body: JSON.stringify({ product_id, qty, note, type }) }),
  movements: (productId = '') => request<{ movements: StockMovement[] }>(`/api/admin/inventory/movements?product_id=${productId}`),

  // shared purchasing — admins and managers can prepare and review stock requests
  purchasingCatalog: () => request<{ products: Product[]; can_receive: boolean }>('/api/purchasing/catalog'),
  reorders: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/reorders'),
  consignments: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/consignments'),
  createReorder: (payload: { title: string; notes: string; client_txn_id: string; items: { product_id: string; qty: number }[] }) =>
    request<{ record: PurchasingRecord; duplicate: boolean }>('/api/purchasing/reorders', { method: 'POST', body: JSON.stringify(payload) }),

  // customers
  customers: (q = '') => request<{ customers: Customer[] }>(`/api/admin/customers?q=${encodeURIComponent(q)}`),
  customer: (id: string) =>
    request<{ customer: Customer; bikes: CustomerBikeLink[]; purchases: Sale[] }>(`/api/admin/customers/${id}`),
  createCustomer: (c: Partial<Customer>) => request<{ customer: Customer }>('/api/admin/customers', { method: 'POST', body: JSON.stringify(c) }),

  // controls
  codes: () => request<{ codes: ActivationCode[] }>('/api/admin/codes'),
  createCode: (label: string, role: string, days = 7, permissions: string[] = []) =>
    request<{ code: ActivationCode }>('/api/admin/codes', {
      method: 'POST',
      body: JSON.stringify({ label, role, days, permissions }),
    }),
  devWipe: () =>
    request<{ ok: boolean }>('/api/admin/dev/wipe', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'WIPE' }),
    }),
  revokeCode: (id: string) => request<{ ok: boolean }>(`/api/admin/codes/${id}`, { method: 'DELETE' }),
  staff: () => request<{ users: User[] }>('/api/auth/staff'),
  updateUser: (id: string, patch: Partial<User>) => request<{ user: User }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  approvals: (status = 'pending') => request<{ approvals: Approval[] }>(`/api/admin/approvals?status=${status}`),
  decideApproval: (id: string, decision: 'approved' | 'rejected', note = '') =>
    request<{ approval: Approval }>(`/api/admin/approvals/${id}/decide`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
  audit: () => request<{ entries: AuditEntry[] }>('/api/admin/audit'),

  // push
  vapidPublicKey: () => request<{ publicKey: string }>('/api/push/vapid-public-key'),
  subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: boolean }>('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub, user_agent: navigator.userAgent }) }),
  testPush: () => request<{ ok: boolean }>('/api/admin/push/test', { method: 'POST' }),
}

export const API_URL_EXPOSED = API_URL
