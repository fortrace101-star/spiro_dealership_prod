import type { Bike, Product } from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
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
export function getStoredUser(): { id: string; full_name: string; role: string } | null {
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

export const api = {
  health: () => request<{ ok: boolean }>('/api/health', {}, 5000),

  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; full_name: string; role: string } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (data: { code: string; full_name: string; password: string; device_id: string }) =>
    request<{ token: string; user: { id: string; full_name: string; role: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  bootstrap: () => request<SyncPayload>('/api/sync/bootstrap'),
  changes: (since: number) => request<SyncPayload>(`/api/sync/changes?since=${since}`),
  push: (sales: unknown[]) =>
    request<PushResult>('/api/sync/push', { method: 'POST', body: JSON.stringify({ sales }) }),
}
