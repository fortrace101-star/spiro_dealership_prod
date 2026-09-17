import type { Bike, Product, SessionUser } from './types'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/+$/, '')
const TOKEN_KEY = 'spiro_pos_token'
const USER_KEY = 'spiro_pos_user'
const DEVICE_KEY = 'spiro_pos_device_id'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setSession(token: string, user: { id: string; full_name: string; role: string }) {
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
      if (res.status === 401) clearSession()
      throw new Error(msg)
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
    category: 'Spare part' | 'Accessory' | 'Consumable'
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
  items: { product_id: string; sku: string; name: string; qty: number; unit_cost: number; reorder_level: number }[]
  notes: string | null
  created_by_name?: string
  created_at: string
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health', {}, 5000),

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

  bootstrap: () => request<SyncPayload>('/api/sync/bootstrap'),
  changes: (since: number) => request<SyncPayload>(`/api/sync/changes?since=${since}`),
  push: (sales: unknown[]) =>
    request<PushResult>('/api/sync/push', { method: 'POST', body: JSON.stringify({ sales }) }),

  purchasingCatalog: () =>
    request<{ products: PurchasingProduct[]; can_receive: boolean }>('/api/purchasing/catalog'),

  consignments: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/consignments'),

  reorders: () => request<{ records: PurchasingRecord[] }>('/api/purchasing/reorders'),

  createConsignment: (payload: { reference: string; supplier: string; delivery_cost: number; notes: string; client_txn_id: string; items: PurchasingItem[] }) =>
    request<{ record: PurchasingRecord; duplicate: boolean }>('/api/purchasing/consignments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createReorder: (payload: { title: string; notes: string; client_txn_id: string; items: PurchasingItem[] }) =>
    request<{ record: PurchasingRecord; duplicate: boolean }>('/api/purchasing/reorders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
