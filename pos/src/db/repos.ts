import { uuid } from './uuid'
import { db } from './database'
import type { Bike, Customer, LocalSale, LocalSaleItem, Product, SyncQueueEntry } from '../lib/types'

// ---------- Catalog ----------
/**
 * Store a catalog snapshot. `replace` is used on the first full bootstrap, where
 * the server response IS the whole sellable catalog: anything absent has been
 * removed server-side (e.g. a data reset) and must stop being sellable locally,
 * otherwise the terminal keeps selling products the server can no longer match.
 */
export async function saveCatalog(products: Product[], bikes: Bike[], categories: string[], opts: { replace?: boolean } = {}) {
  await db.transaction('rw', db.products, db.bikes, db.categories, async () => {
    if (products.length) await db.products.bulkPut(products)
    if (bikes.length) await db.bikes.bulkPut(bikes)
    if (opts.replace) {
      const keepProducts = new Set(products.map((p) => p.id))
      const keepBikes = new Set(bikes.map((b) => b.id))
      await db.products.filter((p) => !keepProducts.has(p.id)).delete()
      await db.bikes.filter((b) => !keepBikes.has(b.id)).delete()
    }
    await db.categories.clear()
    if (categories.length) await db.categories.bulkAdd(categories)
  })
}

export function getAllProducts() {
  return db.products.toArray()
}
export function getAllBikes() {
  return db.bikes.where('status').equals('in_stock').toArray()
}
export function getCategories() {
  return db.categories.toArray()
}
export async function getProductByBarcode(barcode: string): Promise<Product | undefined> {
  return db.products.where('barcode').equals(barcode).first()
}

// ---------- Customers (synced from server as a full list; no updated_at column) ----------

export async function saveCustomers(customers: Customer[]): Promise<void> {
  await db.transaction('rw', db.customers, async () => {
    await db.customers.clear()
    if (customers.length) await db.customers.bulkAdd(customers)
  })
}

export function getCustomers(): Promise<Customer[]> {
  return db.customers.toArray()
}

// ---------- Settings / cursor ----------
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row ? (row.value as T) : fallback
}
export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value })
}

// ---------- Sales ----------
export interface CheckoutInput {
  cashier_id: string
  cashier_name: string
  device_id: string
  customer_name: string | null
  customer_phone: string | null
  discount: number
  payment_method: LocalSale['payment_method']
  amount_paid: number
  items: Omit<LocalSaleItem, 'sale_id' | 'id'>[]
}

/**
 * Atomic offline sale: sale + items + sync queue entry all commit together,
 * or not at all (per POS.md §19). Returns the stored sale.
 */
export async function createSale(input: CheckoutInput): Promise<LocalSale> {
  const id = uuid()
  const clientTxnId = `POS-${input.device_id}-${id}`
  const subtotal = input.items.reduce((s, it) => s + it.line_total, 0)
  const discount = Math.max(0, Math.min(input.discount, subtotal))
  const total = subtotal - discount
  const changeDue = input.payment_method === 'credit' ? 0 : Math.max(0, input.amount_paid - total)

  const sale: LocalSale = {
    id,
    client_txn_id: clientTxnId,
    receipt_no: `LOCAL-${id.slice(0, 8).toUpperCase()}`,
    cashier_id: input.cashier_id,
    cashier_name: input.cashier_name,
    device_id: input.device_id,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    subtotal,
    discount,
    total,
    payment_method: input.payment_method,
    amount_paid: input.amount_paid,
    change_due: changeDue,
    status: 'pending_sync',
    attempts: 0,
    created_at: new Date().toISOString(),
    synced_at: null,
  }

  const items: LocalSaleItem[] = input.items.map((it) => ({ ...it, sale_id: id }))
  const queueEntry: SyncQueueEntry = {
    entity: 'sale',
    entityId: id,
    operation: 'create',
    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  await db.transaction('rw', db.sales, db.saleItems, db.syncQueue, async () => {
    await db.sales.add(sale)
    await db.saleItems.bulkAdd(items)
    await db.syncQueue.add(queueEntry)
  })

  return sale
}

export function getSaleWithItems(id: string) {
  return Promise.all([db.sales.get(id), db.saleItems.where('sale_id').equals(id).toArray()])
}

export function getRecentSales(limit = 50) {
  return db.sales.orderBy('created_at').reverse().limit(limit).toArray()
}

export function getTodaySales() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return db.sales.where('created_at').aboveOrEqual(start.toISOString()).toArray()
}

export function getPendingSales() {
  return db.sales.where('status').equals('pending_sync').toArray()
}

/** Mark synced with the server-assigned receipt number */
export async function markSaleSynced(clientTxnId: string, serverReceipt: string) {
  await db.transaction('rw', db.sales, db.syncQueue, async () => {
    await db.sales.where('client_txn_id').equals(clientTxnId).modify({
      status: 'synced',
      synced_at: new Date().toISOString(),
      server_receipt_no: serverReceipt,
    })
    await db.syncQueue.where('entityId').equals(clientTxnIdToSaleId(clientTxnId)).modify({ status: 'done' })
  })
}

function clientTxnIdToSaleId(clientTxnId: string): string {
  // client_txn_id = `POS-{device}-{uuid}` → last segment after final dash
  const idx = clientTxnId.indexOf('-', 4)
  return clientTxnId.slice(idx + 1)
}

export async function incrementSaleAttempts(saleId: string) {
  await db.sales.where('id').equals(saleId).modify((sale: LocalSale) => {
    sale.attempts = (sale.attempts || 0) + 1
  })
}

// ---------- Queue ----------
export function getPendingQueue() {
  return db.syncQueue.where('status').equals('pending').toArray()
}
export async function countPendingSales(): Promise<number> {
  return db.sales.where('status').equals('pending_sync').count()
}
