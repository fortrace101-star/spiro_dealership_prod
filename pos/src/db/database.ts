import Dexie, { type Table } from 'dexie'
import type { Bike, LocalSale, LocalSaleItem, Product, SyncQueueEntry } from '../lib/types'

export interface SettingRow {
  key: string
  value: unknown
}

export class SpiroPosDB extends Dexie {
  products!: Table<Product, string>
  bikes!: Table<Bike, string>
  categories!: Table<string, number>
  sales!: Table<LocalSale, string>
  saleItems!: Table<LocalSaleItem, number>
  syncQueue!: Table<SyncQueueEntry, number>
  settings!: Table<SettingRow, string>

  constructor() {
    super('spiroPosDatabase')
    this.version(1).stores({
      products: 'id, barcode, sku, name, category, updated_at',
      bikes: 'id, vin, model, status, updated_at',
      categories: '++',
      sales: 'id, client_txn_id, status, created_at',
      saleItems: '++id, sale_id, product_id, bike_id',
      syncQueue: '++queueId, entity, entityId, status, createdAt',
      settings: 'key',
    })
  }
}

export const db = new SpiroPosDB()
