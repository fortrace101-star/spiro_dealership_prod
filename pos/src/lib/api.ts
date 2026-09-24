import type {
  Bike, BikeReservation, CreditDecision, CreditOutstandingSale, CreditPendingSale, Customer, InstallmentPayment, Product, SessionUser,
} from './types'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '')
const TOKEN_KEY = 'spiro_pos_token'
const USER_KEY = 'spiro_pos_user'
const DEVICE_KEY = 'spiro_pos_device_id'

/**
 * Fired (server message in `detail.message`) when a request is rejected with a
 * 401 while we still hold a session — the admin deactivated the account or the
 * token expired. The app shell listens and drops back to the sign-in screen.
 * Failed sign-ins have no token and never fire it.
 */
export const SESSION_EXPIRED_EVENT = 'spiro:session-expired'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function getStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Capability check for POS UI gating.
 *
 * The server is the authority — every route re-checks the same permission — this
 * only decides what the terminal offers. We test `effective_permissions` (role
 * baseline ∪ admin grants) so a manager-only operation (receiving, reservations,
 * installments) stays hidden for a plain operator and appears the moment the
 * admin grants it. Call `api.me()` to refresh after a grant/revoke.
 */
export function can(permission: string, user: SessionUser | null = getStoredUser()): boolean {
  if (!user) return false
  return (user.effective_permissions || []).includes(permission)
}

/** Stable per-terminal device id */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    id = `POS-${rand}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

/** Row of the durable cross-app inbox (shared with the admin dashboard). */
export interface AppNotification {
  id: string
  kind: string
  title: string
  body: string
  url: string | null
  tag: string | null
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

/** Carries the HTTP status so callers can react to specific codes (e.g. 409). */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const token = getToken()
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* empty */
    }
    if (!res.ok) {
      const msg = (body as { error?: string })?.error || `Request failed (${res.status})`
      if (res.status === 401) {
        // A 401 while a token was attached means the session was revoked
        // (admin deactivated POS access) or it expired: clear the local
        // session and tell the app shell to log out immediately.
        const hadSession = Boolean(token)
        clearSession()
        if (hadSession) {
          window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message: msg } }))
        }
      }
      throw new ApiError(msg, res.status)
    }
    return body as T
  } finally {
    clearTimeout(timer)
  }
}

export interface SyncPayload {
  products: Product[]
  bikes: Bike[]
  categories: string[]
  customers: Customer[]
  cursor: number
  server_time: string
}

export interface PushResult {
  ok: boolean
  server_time: string
  accepted: { client_txn_id: string; id: string; receipt_no: string }[]
  duplicates: string[]
  failed: { client_txn_id: string; error: string }[]
}

export interface PurchasingProduct {
  id: string
  sku: string
  name: string
  stock_qty: number
  reorder_level: number
  cost_price: string | number
  selling_price: number
}

/** Per-lifecycle-state counts for reorder list badges.
 *  pending    = list created but not yet acted on
 *  processed  = list prepared/sent for ordering
 *  fulfilled  = stock received against it (no longer counts toward attention)
 *  cancelled  = shop decided not to order after all */
export interface ReorderCounts {
  counts: { pending: number; processed: number; fulfilled: number; cancelled: number }
}

/** Canonical product categories used across POS + server.
 *
 *  Major sections:
 *   1. I.C.E Spare Parts and Accessories  → 'Spare Parts' | 'Accessories' | 'Consumables'
 *   2. e-Bikes                            → the VIN-tracked bike itself
 *   3. e-Bikes Spare Parts                → its own major section
 *
 *  The server CHECK also accepts the legacy values ('e-Bike','e-Bike Spare Parts',
 *  'Spare Parts','Spare part','Accessory','Consumable') for backward
 *  compatibility with offline DBs, but the UI offers only this curated set. */
export const PRODUCT_CATEGORIES = [
  'Spare Parts',
  'Accessories',
  'Consumables',
  'e-Bikes',
  'e-Bikes Spare Parts',
] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

/** Leaf categories belonging to the I.C.E major section. */
export const ICE_GROUP_CATEGORIES = ['Spare Parts', 'Accessories', 'Consumables'] as const

/** Map any legacy category value to its canonical replacement (identity otherwise). */
const LEGACY_CATEGORY_MAP: Record<string, ProductCategory> = {
  'e-Bike': 'e-Bikes',
  'e-Bike Spare Parts': 'e-Bikes Spare Parts',
  'Spare Parts': 'Spare Parts',
  'Spare part': 'Spare Parts',
  Accessory: 'Accessories',
  Consumable: 'Consumables',
}
export function normalizeCategory(c: string | null | undefined): string {
  if (!c) return ''
  return LEGACY_CATEGORY_MAP[c] ?? c
}

export interface PurchasingItem {
  product_id: string | null
  sku: string
  name: string
  qty: number
  unit_cost: number
  reorder_level: number
  new_product?: {
    sku: string
    name: string
    barcode: string
    category: ProductCategory
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
  items: PurchasingItem[]
  notes: string | null
  created_by_name?: string
  source_list_id?: string | null
  source_list_title?: string | null
  fulfilled?: boolean
  fulfilled_at?: string | null
  status?: 'pending' | 'processed' | 'fulfilled' | 'cancelled'
  created_at: string
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health', {}, 5000),

  /**
   * Public first-launch probe: true while the install has no administrator
   * (fresh or just-wiped database). Activation codes cannot exist yet in that
   * state, so the terminal must say so instead of rejecting every code.
   */
  setupStatus: () => request<{ setup_required: boolean }>('/api/setup/status', {}, 5000),

  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (data: { code: string; full_name: string; email: string; password: string; device_id: string }) =>
    request<{ token: string; user: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Refresh the session profile (role baseline ∪ grants). The Team page can
   * change an operator's grants at any moment; the next call re-reads them.
   */
  me: () => request<{ user: SessionUser }>('/api/auth/me'),

  bootstrap: () => request<SyncPayload>('/api/sync/bootstrap'),
  changes: (since: number) => request<SyncPayload>(`/api/sync/changes?since=${since}`),
  push: (sales: unknown[]) =>
    request<PushResult>('/api/sync/push', { method: 'POST', body: JSON.stringify({ sales }) }),

  purchasingCatalog: () =>
    request<{
      products: PurchasingProduct[]
      can_receive: boolean
      /** Legacy flag — mirrors `can_receive` (inline product creation is part of receiving). */
      can_create_products: boolean
      can_reorder: boolean
      can_manage_reorders: boolean
    }>('/api/purchasing/catalog'),

  consignments: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/consignments'),

  reorders: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/reorders'),

  // Counts per lifecycle state for badge queries (admin category tabs + POS badge).
  // Only pending + processed count toward the attention badge; fulfilled lists
  // (already received) and cancelled lists are excluded from it.
  reorderCounts: () => request<ReorderCounts>('/api/purchasing/reorders/counts'),

  // Server-generated default title for a new reorder list: Reorder - 20 Sep - 01.
  nextReorderRef: () => request<{ title: string }>('/api/purchasing/reorders/next-ref'),

  // Reorder-list lifecycle: pending -> processed (list prepared) -> fulfilled (stock received).
  // 'cancelled' retires a list the shop decided not to order after all.
  updateReorderStatus: (id: string, status: 'pending' | 'processed' | 'cancelled') =>
    request<{ ok: boolean }>(`/api/purchasing/reorders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  createConsignment: (payload: {
    reference: string
    supplier: string
    delivery_cost: number
    notes: string
    client_txn_id: string
    items: PurchasingItem[]
    source_list_id?: string | null
  }) =>
    request<{ record: PurchasingRecord; duplicate: boolean }>('/api/purchasing/consignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createReorder: (payload: { title: string; notes: string; client_txn_id: string; items: PurchasingItem[] }) =>
    request<{ record: PurchasingRecord; duplicate: boolean }>('/api/purchasing/reorders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ---------- Bike reservations & installments (online only) ----------
  // Reservations lock a VIN server-side: they can never queue offline, so the
  // UI must refuse these calls when navigator.onLine is false.
  reservationsLookup: (status = 'active', q = '') =>
    request<{ reservations: BikeReservation[] }>(
      `/api/pos/reservations?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`,
    ),

  reservationDetail: (id: string) =>
    request<{ reservation: BikeReservation }>(`/api/pos/reservations/${id}`),

  createReservation: (payload: {
    bike_id: string
    customer_name: string
    customer_phone: string
    total_price: number
    down_payment: number
    plan_months?: number
    payment_method?: string
    transaction_ref?: string
    notes?: string
  }) =>
    request<{ reservation: BikeReservation }>('/api/pos/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recordInstallment: (id: string, payment: { amount: number; payment_method?: string; transaction_ref?: string; note?: string }) =>
    request<{ payment: InstallmentPayment; balance: number; reservation: BikeReservation }>(
      `/api/pos/reservations/${id}/payments`,
      { method: 'POST', body: JSON.stringify(payment) },
    ),

  completeReservation: (id: string) =>
    request<{ reservation: BikeReservation }>(`/api/pos/reservations/${id}/complete`, { method: 'POST' }),

  releaseReservation: (id: string, note?: string) =>
    request<{ reservation?: BikeReservation; pendingApproval?: boolean; message?: string }>(`/api/pos/reservations/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ note: note || null }),
    }),

  // ---------- Credit sales: approval queue, finalize, settlement payments ----------
  // Online-only: finalize moves real stock and payments record real money;
  // client_txn_id makes every retry (double-tap, network blip) idempotent.
  creditSales: (q = '') =>
    request<{ pending: CreditPendingSale[]; outstanding: CreditOutstandingSale[] }>(
      `/api/pos/credit-sales${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),

  creditStatus: (since?: string) =>
    request<{ decisions: CreditDecision[] }>(`/api/pos/credit-status${since ? `?since=${encodeURIComponent(since)}` : ''}`),

  finalizeCredit: (saleId: string, input: { device_id?: string; client_txn_id: string }) =>
    request<{ ok: boolean; duplicate: boolean; sale: { id: string; receipt_no: string; status: string } }>(
      `/api/pos/credit-sales/${saleId}/finalize`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  // Confirm reception of a rejected decision — server keeps the rejected sale
  // in the credit-desk queue until this lands (mirror of Finalize; idempotent).
  ackCreditRejection: (saleId: string) =>
    request<{ ok: boolean; sale_id: string }>(`/api/pos/credit-sales/${saleId}/ack`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  creditPayment: (
    saleId: string,
    input: { amount: number; payment_method: string; note?: string; device_id?: string; client_txn_id: string },
  ) =>
    request<{ ok: boolean; duplicate: boolean; paid: number; balance: number; status: 'settled' | 'outstanding' }>(
      `/api/pos/credit-sales/${saleId}/payments`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  // ---------- Web Push (POS bell: credit decisions → the operator finalizes) ----------
  vapidPublicKey: () => request<{ publicKey: string }>('/api/push/vapid-public-key'),

  subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ ...sub, user_agent: navigator.userAgent }),
    }),

  // ---------- Notifications: durable inbox shared with the admin dashboard ----------
  notifications: () => request<{ notifications: AppNotification[]; unread_count: number }>('/api/notifications'),
  unreadCount: () => request<{ unread_count: number }>('/api/notifications/unread-count'),
  markNotificationRead: (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),
}
