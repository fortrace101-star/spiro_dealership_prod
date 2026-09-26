import { api } from '../lib/api'
import { db } from '../db/database'
import {
  countPendingSales, getPendingSales, getSetting, incrementSaleAttempts,
  markSaleSynced, saveCatalog, saveCustomers, setSetting,
} from '../db/repos'
import type { LocalSale, LocalSaleItem } from '../lib/types'

export interface SyncStatus {
  online: boolean
  lastSyncAt: string | null
  lastAttemptAt: string | null
  syncing: boolean
  pendingCount: number
  lastError: string | null
  seenByServer: boolean
}

type Listener = (status: SyncStatus) => void

const listeners = new Set<Listener>()
let status: SyncStatus = {
  online: false,
  lastSyncAt: null,
  lastAttemptAt: null,
  syncing: false,
  pendingCount: 0,
  lastError: null,
  seenByServer: false,
}

export function getSyncStatus(): SyncStatus {
  return { ...status }
}

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn)
  fn(getSyncStatus())
  return () => {
    listeners.delete(fn)
  }
}

function update(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const fn of listeners) fn(getSyncStatus())
}

function saleToPayload(sale: LocalSale, items: LocalSaleItem[]) {
  const costTotal = items.reduce((sum, it) => sum + Number(it.unit_cost || 0) * it.qty, 0)
  return {
    client_txn_id: sale.client_txn_id,
    cashier_id: sale.cashier_id,
    device_id: sale.device_id,
    customer: sale.customer_phone ? { name: sale.customer_name, phone: sale.customer_phone } : undefined,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    cost_total: Number(costTotal.toFixed(2)),
    payment_method: sale.payment_method,
    amount_paid: sale.amount_paid,
    change_due: sale.change_due,
    created_at: sale.created_at,
    items: items.map((it) => ({
      product_id: it.product_id,
      bike_id: it.bike_id,
      name: it.name,
      kind: it.kind,
      qty: it.qty,
      unit_price: it.unit_price,
      unit_cost: it.unit_cost,
      line_total: it.line_total,
    })),
  }
}

/** Push pending sales to the server (idempotent via client_txn_id). */
async function pushPending(): Promise<void> {
  const sales = await getPendingSales()
  update({ pendingCount: sales.length })
  if (sales.length === 0) return

  for (const sale of sales) {
    const items = await db.saleItems.where('sale_id').equals(sale.id).toArray()
    try {
      await incrementSaleAttempts(sale.id)
      const res = await api.push([saleToPayload(sale, items)])
      const accepted = res.accepted.find((a) => a.client_txn_id === sale.client_txn_id)
      const isDuplicate = res.duplicates.includes(sale.client_txn_id)
      if (accepted || isDuplicate) {
        // Server has it (or already had it) — mark synced either way
        await markSaleSynced(sale.client_txn_id, accepted?.receipt_no || sale.receipt_no)
      } else {
        const fail = res.failed.find((f) => f.client_txn_id === sale.client_txn_id)
        update({ lastError: fail?.error || 'Sale rejected by server' })
      }
    } catch (err) {
      // Network died mid-batch — stop; remaining sales stay queued
      update({ lastError: err instanceof Error ? err.message : 'Sync failed' })
      throw err
    }
  }
}

/** Pull incremental catalog changes since our cursor (bootstrap on first run). */
async function pullChanges(): Promise<void> {
  const cursor = await getSetting<number>('sync_cursor', 0)
  const res = cursor === 0 ? await api.bootstrap() : await api.changes(cursor)
  // The server also sends every sellable id, so local rows it no longer has
  // (deleted product, sold bike, reset dataset) stop being sold here.
  await saveCatalog(res.products, res.bikes, res.categories)
  await saveCustomers(res.customers)
  await setSetting('sync_cursor', res.cursor)
}

/** One full sync cycle: health check → push pending → pull changes. */
export async function runSyncCycle(reason: 'interval' | 'online-event' | 'manual' | 'after-sale' | 'after-reservation' | 'after-receive' | 'after-edit' | 'after-adjust'): Promise<void> {
  if (status.syncing) return
  update({ syncing: true, lastAttemptAt: new Date().toISOString() })
  try {
    await api.health() // real server reachability, not navigator.onLine alone
    update({ online: true, seenByServer: true, lastError: null })

    await pushPending()
    await pullChanges()

    update({ lastSyncAt: new Date().toISOString(), pendingCount: await countPendingSales() })
  } catch {
    update({ online: false, seenByServer: false })
  } finally {
    update({ syncing: false })
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Start periodic polling (default 30s) + browser online/offline listeners. */
export function startSyncEngine(intervalMs = 30_000) {
  if (timer) return
  void runSyncCycle('interval')
  timer = setInterval(() => void runSyncCycle('interval'), intervalMs)

  window.addEventListener('online', () => void runSyncCycle('online-event'))
  window.addEventListener('offline', () => update({ online: false, seenByServer: false }))
}
