# Browser-Based Offline-First POS — Conversation Documentation

## 1. Original Idea

The project started with a browser-based application that needed to function as a **Point of Sale (POS)** system and work with a physical barcode scanner.

The initial questions were essentially:

- How can a browser-based app receive barcode scans?
- Does the POS page need to be open before a barcode scanner can trigger an order?
- How should the application behave when the internet goes down?
- Can the POS continue selling offline?
- How can products, sales, and inventory synchronize later?
- How should the React/Vite frontend, Express backend, PostgreSQL database, barcode scanner, and offline storage fit together?

The solution evolved from a simple barcode-input question into a complete **offline-first POS architecture with synchronization**.

---

# 2. Barcode Scanner and Browser POS

## 2.1 How the barcode scanner communicates

A typical USB barcode scanner can operate as a **HID keyboard device**.

When a barcode is scanned, the scanner effectively types the barcode into the currently focused application and commonly sends an `Enter` key afterward.

Conceptually:

```text
Barcode
   ↓
Barcode Scanner
   ↓
USB / HID Keyboard Input
   ↓
Operating System
   ↓
Browser
   ↓
POS React Application
   ↓
Barcode Handler
   ↓
Product Lookup
   ↓
Cart
```

The scanner does not need to understand React, JavaScript, or the POS application directly.

## 2.2 Does the POS have to be open?

Yes, for the browser-based workflow the POS application needs to be running and able to receive the scanner's keyboard input.

The scanner does not normally send a request directly to the React application.

Instead:

```text
Scanner → Keyboard Events → Browser → React POS
```

Therefore, the POS screen should normally be open on the terminal being used for sales.

The important architectural realization was that the POS does **not** need an internet connection to interpret a scanner input, provided that:

1. The application itself is available offline.
2. The product database needed for the scan is available locally.

That led to the offline-first architecture.

---

# 3. The "Sync Later" Requirement

The next major requirement was:

> The POS should continue operating when the internet disappears and synchronize transactions later.

This changed the design from a traditional online POS into an **offline-first POS**.

The central principle became:

> **The POS should not stop selling simply because the internet stops.**

The cloud/server remains important, but it is no longer required for every individual sale.

---

# 4. Offline-First Architecture

The proposed architecture has these major components:

```text
                    ┌──────────────────────────┐
                    │       PostgreSQL         │
                    │      Central Database    │
                    └────────────▲─────────────┘
                                 │
                                 │ Sync
                                 │
                    ┌────────────┴─────────────┐
                    │       Express API        │
                    │       Backend Server     │
                    └────────────▲─────────────┘
                                 │
                         Internet / Network
                                 │
             ┌───────────────────┴───────────────────┐
             │                                       │
     ┌───────┴────────┐                     ┌────────┴───────┐
     │    POS #1      │                     │     POS #2     │
     │ React + Vite   │                     │ React + Vite   │
     │ PWA            │                     │ PWA            │
     │ IndexedDB      │                     │ IndexedDB      │
     └────────────────┘                     └────────────────┘
             │                                       │
       Barcode Scanner                         Barcode Scanner
```

Each POS terminal has its own local operational data.

The server is the central source for shared business data, reporting, administration, and synchronization.

---

# 5. Two Different Offline Problems

An important distinction was identified between:

### Problem A — Can the application itself open offline?

This is solved by a **Service Worker / PWA**.

### Problem B — Can the POS access business data offline?

This is solved by **IndexedDB**.

These are separate problems.

A Service Worker can make the application available offline, but it does not automatically make the entire business database available offline.

---

# 6. Progressive Web App / Service Worker

## 6.1 Why use a PWA?

A React/Vite application normally loads JavaScript, CSS, HTML, fonts, icons, and other assets from the server.

If the internet disappears and those files have not been cached, the browser may not be able to start the application.

A Service Worker solves this by caching the application shell.

The flow becomes:

```text
First Online Visit
       ↓
Browser downloads React application
       ↓
Service Worker installs
       ↓
Application assets are cached
       ↓
Internet disappears
       ↓
Browser loads cached application
       ↓
POS starts normally
```

The POS can therefore reopen even without internet after it has been initialized online.

## 6.2 Important limitation

The terminal must have opened and initialized the POS while online at least once.

Offline support is not magic.

A terminal that has never loaded the application cannot depend on an unavailable server to download the application for the first time.

---

# 7. React + Vite PWA Configuration

The implementation uses:

- React
- Vite
- `vite-plugin-pwa`
- Service Worker
- IndexedDB
- Dexie

Install the relevant packages:

```bash
npm install dexie
npm install -D vite-plugin-pwa
```

## 7.1 Vite configuration

Example:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'POS',
        short_name: 'POS',
        description: 'Offline-first Point of Sale',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/pwa-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },

      workbox: {
        cleanupOutdatedCaches: true,

        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ]
})
```

The API was deliberately not treated as ordinary static application caching.

Business data needs controlled synchronization rather than blindly caching arbitrary API responses.

---

# 8. Registering the Service Worker

Create:

```text
src/pwa.js
```

Example:

```javascript
import { registerSW } from 'virtual:pwa-register'

registerSW({
  onNeedRefresh() {
    console.log('A new POS version is available.')
  },

  onOfflineReady() {
    console.log('POS is ready to work offline.')
  }
})
```

Then import it from:

```text
src/main.jsx
```

For example:

```javascript
import './pwa'
```

---

# 9. PWA Assets

Add the required icons:

```text
public/
└── icons/
    ├── pwa-192.png
    └── pwa-512.png
```

---

# 10. Testing Offline Application Availability

Build and preview the production application:

```bash
npm run build
npm run preview
```

Then use Chrome/Edge DevTools.

Check:

```text
Application
   ├── Service Workers
   └── Cache Storage
```

The browser should show the Service Worker and cached application resources.

A practical test is:

```text
1. Open the POS while online.
2. Allow the Service Worker to install.
3. Confirm the application loads.
4. Open DevTools.
5. Switch Network to Offline.
6. Reload the application.
```

The application should still start.

---

# 11. IndexedDB for POS Data

The Service Worker handles application availability.

IndexedDB handles persistent business data.

Recommended data includes:

- Products
- Categories
- Customers
- Sales
- Sale items
- Sync queue
- Settings
- Potentially local inventory movements
- Sync metadata/cursors

Dexie was selected as a convenient wrapper around IndexedDB.

Install:

```bash
npm install dexie
```

---

# 12. Dexie Database

Create:

```text
src/db/database.js
```

Example:

```javascript
import Dexie from 'dexie'

export const db = new Dexie('posDatabase')

db.version(1).stores({
  products: 'id, barcode, sku, name, updatedAt',
  categories: 'id, name',
  customers: 'id, phone, name',
  sales: 'id, receiptNumber, status, createdAt',
  saleItems: 'id, saleId, productId',
  syncQueue: '++queueId, entity, entityId, operation, status, createdAt',
  settings: 'key'
})
```

---

# 13. Product Repository

Create:

```text
src/db/products.js
```

Example:

```javascript
import { db } from './database'

export async function getProductByBarcode(barcode) {
  return db.products.where('barcode').equals(barcode).first()
}

export async function saveProducts(products) {
  await db.products.bulkPut(products)
}

export async function getAllProducts() {
  return db.products.toArray()
}
```

The important point is that a barcode lookup should normally happen against local IndexedDB rather than making a network request for every scan.

---

# 14. Product Synchronization

Create:

```text
src/services/productSync.js
```

Example:

```javascript
import { saveProducts } from '../db/products'

const API_URL = import.meta.env.VITE_API_URL

export async function syncProducts() {
  const response = await fetch(`${API_URL}/api/products`)

  if (!response.ok) {
    throw new Error('Unable to synchronize products')
  }

  const products = await response.json()

  await saveProducts(products)
}
```

This gives the POS a local product catalogue that can be used when offline.

---

# 15. Barcode Scanner Service

A basic scanner listener can collect keyboard events until the scanner sends `Enter`.

Example:

```javascript
let buffer = ''
let timeout

export function startBarcodeScanner(onBarcode) {
  function handleKeyDown(event) {
    clearTimeout(timeout)

    if (event.key === 'Enter') {
      if (buffer.length > 0) {
        onBarcode(buffer)
        buffer = ''
      }

      return
    }

    if (event.key.length === 1) {
      buffer += event.key
    }

    timeout = setTimeout(() => {
      buffer = ''
    }, 100)
  }

  window.addEventListener('keydown', handleKeyDown)

  return () => {
    window.removeEventListener('keydown', handleKeyDown)
  }
}
```

The `100ms` timeout is based on the fact that scanner keystrokes are normally much faster and more consistent than human typing.

A production implementation should also:

- Avoid intercepting normal text input.
- Consider which element currently has focus.
- Distinguish scanner input from manual keyboard entry.
- Support scanners configured with different suffixes.
- Handle scanner configuration and timing appropriately.

---

# 16. Barcode-to-Cart Flow

The final desired flow is:

```text
Scan Barcode
      ↓
Barcode Listener
      ↓
Read Local IndexedDB
      ↓
Find Product
      ↓
Add Product to Cart
      ↓
Update Redux UI State
```

Not:

```text
Scan
 ↓
Internet
 ↓
Server
 ↓
Database
 ↓
Response
 ↓
Cart
```

The first design is much more resilient to network interruptions.

---

# 17. Redux Toolkit vs IndexedDB

A major architectural distinction was made.

## Redux Toolkit

Redux should hold active application/UI state such as:

- Current cart
- Current cashier
- Open modal
- Selected product
- Current payment
- Scanner state
- UI preferences
- Temporary checkout state

## IndexedDB

IndexedDB should hold persistent local operational data:

- Products
- Sales
- Sale items
- Customers
- Inventory information
- Sync queue
- Settings
- Sync metadata

In short:

```text
Redux = current application state

IndexedDB = persistent local business data
```

Redux should not be treated as the permanent offline database.

---

# 18. Creating an Offline Sale

A sale should be created locally first.

Example concept:

```javascript
const sale = {
  id: crypto.randomUUID(),
  receiptNumber: generateLocalReceiptNumber(),
  status: 'pending_sync',
  createdAt: new Date().toISOString(),
  deviceId,
  cashierId,
  subtotal,
  discount,
  tax,
  total,
  paymentMethod,
  amountPaid,
  change
}
```

The sale should be stored locally immediately.

It should not wait for the server.

---

# 19. Atomic Sale Transaction

The sale and its related items should be written atomically.

Conceptually:

```text
IndexedDB Transaction
   ├── Sale
   ├── Sale Items
   └── Sync Queue Entry
```

If the operation fails, the entire transaction should fail rather than leaving an incomplete sale.

Dexie supports transactions for this purpose.

---

# 20. Sync Queue

Every offline operation that must eventually reach the server should have a queue record.

Example:

```text
syncQueue

queueId
entity
entityId
operation
status
createdAt
```

For example:

```text
entity: sale
entityId: 7e...
operation: create
status: pending
```

This queue becomes the bridge between offline activity and the central server.

---

# 21. Syncing Pending Sales

The synchronization process is:

```text
Internet Returns
       ↓
Check API Reachability
       ↓
Read Pending Sync Queue
       ↓
Send Sale to Express
       ↓
Server Validates
       ↓
Server Saves Sale
       ↓
Server Acknowledges Transaction
       ↓
Mark Local Sale as Synced
       ↓
Remove/Complete Queue Entry
```

A sale should only be marked synced after the server has successfully acknowledged it.

---

# 22. Idempotency and Duplicate Prevention

Offline synchronization introduces an important problem:

> What happens if the POS sends a sale to the server, but the network fails before the POS receives the response?

The POS may not know whether the server actually saved the sale.

If it retries, the same sale could be inserted twice.

The solution is an idempotency key.

Every sale should have a unique:

```text
client_transaction_id
```

The PostgreSQL database should enforce uniqueness.

Example:

```text
client_transaction_id UNIQUE
```

The server can then safely receive the same transaction multiple times without creating duplicate sales.

---

# 23. PostgreSQL Sales Data

A conceptual sales table can contain:

```text
id
client_transaction_id
receipt_number
device_id
cashier_id
subtotal
discount
tax
total
payment_method
amount_paid
change
created_at
```

The client transaction ID is particularly important for synchronization.

---

# 24. Push and Pull Synchronization

Synchronization should eventually work in both directions.

## Push

POS → Server:

```text
POST /api/sync/push
```

Used for:

- Sales
- Returns
- Inventory movements
- Other local changes

## Pull

Server → POS:

```text
GET /api/sync/changes?since=<cursor>
```

Used for:

- New products
- Updated products
- Price changes
- Categories
- Other centrally managed changes

---

# 25. Sync Cursors

The POS should not repeatedly download the entire database.

Instead, the server can maintain a change log or synchronization cursor.

Example:

```text
POS last cursor = 1025

Server changes:
1026 → Product updated
1027 → Product created
1028 → Price changed

POS requests:

GET /api/sync/changes?since=1025
```

The server returns only changes after cursor 1025.

The POS then advances its local cursor.

---

# 26. Inventory Synchronization

Inventory is more complicated when multiple POS terminals can operate offline.

Simply synchronizing:

```text
stock = 43
```

can cause conflicts.

A safer approach is to represent inventory changes as movements.

Examples:

```text
PURCHASE     +50
SALE          -1
RETURN        +1
ADJUSTMENT    -2
```

Each movement can contain:

```text
movement_id
product_id
quantity
type
device_id
transaction_id
created_at
```

The server can then reconstruct inventory from the movement history.

This is especially important when multiple terminals sell the same products while disconnected.

---

# 27. Multiple POS Terminals

Every POS terminal should have a unique device ID.

Transactions should record:

```text
device_id
cashier_id
client_transaction_id
created_at
```

This provides traceability and helps with synchronization, auditing, and conflict investigation.

---

# 28. Returns

Returns should be represented as separate transactions or movements rather than simply editing the original sale.

A return should reference the original transaction.

Conceptually:

```text
Original Sale
     ↓
Return Transaction
     ↓
Inventory +1
```

This preserves an audit trail.

---

# 29. Audit Logging

Important operations should be auditable.

An audit log can record:

```text
user
device
action
entity
entity_id
timestamp
metadata
```

Examples:

```text
Cashier created sale
Manager changed price
User performed return
Inventory was adjusted
Product was deleted
```

This is valuable for a real POS system.

---

# 30. Offline Authentication

Offline authentication requires a deliberate security model.

The application should **never store plaintext passwords in IndexedDB**.

Possible approaches include:

- Registering an authorized terminal.
- Maintaining a controlled list of authorized offline users.
- Local credential verification using appropriately protected credentials.
- Short-lived offline sessions.
- Requiring online authentication again after a defined period.
- Forcing reauthentication when connectivity returns where appropriate.

The exact security policy should be determined before production deployment.

---

# 31. Data Freshness

Offline operation creates a second business concern:

> The locally stored product data may be stale.

For example:

```text
Server price = 5,000
POS local price = 4,500
```

if the POS has been offline since the price changed.

The application should therefore show synchronization state such as:

```text
● Online
Last sync: 2 minutes ago
```

or:

```text
● Offline
Last sync: Yesterday 18:42
```

The business should also define policies for how stale prices can become before sales are restricted or require authorization.

---

# 32. Online Status

A browser `online` event is useful, but it does not prove that the backend is reachable.

The implementation should combine:

```text
navigator.onLine
```

with an actual backend health check:

```text
GET /api/health
```

Therefore:

```text
Browser says online
       +
API health check succeeds
       =
Server likely reachable
```

This is more reliable than relying on `navigator.onLine` alone.

---

# 33. Sync Hook

A React hook such as:

```text
src/hooks/useSync.js
```

can:

1. Check connectivity.
2. Ping the API.
3. Push pending local transactions.
4. Pull server changes.
5. Listen for the browser's `online` event.
6. Retry periodically.

A retry interval such as 30 seconds can be used as one possible starting point.

Conceptually:

```text
Application starts
       ↓
Check connection
       ↓
Sync
       ↓
Listen for "online"
       ↓
Sync immediately when connection returns
       ↓
Retry periodically
```

---

# 34. Online Status Hook

A separate hook can monitor:

```text
online
offline
```

browser events.

Example purpose:

```text
src/hooks/useOnlineStatus.js
```

The POS UI can then show a persistent connection indicator.

---

# 35. Suggested Frontend Structure

```text
src/
├── app/
│   ├── store.js
│   └── router.jsx
│
├── components/
│   ├── barcode/
│   ├── cart/
│   ├── checkout/
│   ├── products/
│   └── common/
│
├── features/
│   ├── auth/
│   ├── products/
│   ├── cart/
│   ├── sales/
│   ├── inventory/
│   └── customers/
│
├── db/
│   ├── database.js
│   ├── products.js
│   ├── sales.js
│   └── syncQueue.js
│
├── services/
│   ├── barcodeScanner.js
│   ├── checkoutService.js
│   ├── productSync.js
│   └── syncService.js
│
├── hooks/
│   ├── useBarcodeScanner.js
│   ├── useOnlineStatus.js
│   └── useSync.js
│
├── pages/
│   ├── POS.jsx
│   ├── Products.jsx
│   ├── Inventory.jsx
│   ├── Sales.jsx
│   └── Reports.jsx
│
├── pwa.js
├── App.jsx
└── main.jsx
```

---

# 36. Suggested Backend Structure

The Express backend can be organized as:

```text
server/
├── config/
├── controllers/
├── routes/
├── services/
├── repositories/
├── middleware/
├── app.js
└── server.js
```

The backend remains responsible for:

- Authentication
- Central product data
- Central inventory
- Sales
- Reports
- Synchronization
- Validation
- Idempotency
- Audit logs
- PostgreSQL access

---

# 37. Suggested API

A starting API could include:

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/products
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

POST   /api/sales
GET    /api/sales

GET    /api/inventory
POST   /api/inventory

GET    /api/sync/bootstrap
POST   /api/sync/push
GET    /api/sync/changes

GET    /api/health
```

The exact endpoints can evolve as the implementation becomes more concrete.

---

# 38. POS User Experience

The POS screen should prioritize the physical sales workflow.

A practical layout is:

```text
┌──────────────────────────────────────────────┐
│ POS | Cashier | Online/Offline | Last Sync   │
├───────────────────────┬──────────────────────┤
│                       │                      │
│   Barcode / Search    │      Cart            │
│                       │                      │
│   Product Results     │      Items           │
│                       │      Quantities       │
│                       │      Totals           │
│                       │                      │
├───────────────────────┴──────────────────────┤
│             Checkout / Payment                │
└──────────────────────────────────────────────┘
```

The barcode scanner should be a first-class part of the workflow.

The cashier should not have to wait for an API request after every scan.

---

# 39. Complete Offline Sales Lifecycle

The intended end-to-end workflow is:

```text
ONLINE
  ↓
Open POS
  ↓
Products synchronize
  ↓
Service Worker available
  ↓
IndexedDB populated
  ↓
Internet disconnects
  ↓
Close browser
  ↓
Reopen POS
  ↓
Service Worker loads application
  ↓
IndexedDB loads products
  ↓
Scan barcode
  ↓
Local product lookup
  ↓
Add to cart
  ↓
Checkout
  ↓
Create sale locally
  ↓
Save sale + sale items + sync queue
  ↓
Print receipt
  ↓
Continue selling
  ↓
Internet returns
  ↓
API becomes reachable
  ↓
Push pending transactions
  ↓
Server validates and stores them
  ↓
Server acknowledges
  ↓
Local sales marked synced
  ↓
Pull product/price changes
  ↓
POS returns to synchronized state
```

This is the core operational model.

---

# 40. What Happens When the Internet Goes Off?

The final understanding was that two layers keep the POS operational.

## Application layer

Service Worker/PWA:

```text
Keeps the React application available.
```

## Data layer

IndexedDB:

```text
Keeps local business data available.
```

Therefore:

```text
Internet OFF
     │
     ├── Service Worker → App still opens
     │
     └── IndexedDB → Products and sales still available
```

The limitation is data freshness, not basic application availability.

---

# 41. What Happens When the Browser Is Closed?

If the PWA and IndexedDB have already been initialized:

```text
Close browser
      ↓
Open browser again
      ↓
Load cached application
      ↓
Load local IndexedDB data
      ↓
POS resumes
```

Local sales remain stored in IndexedDB.

They are not lost simply because the browser was closed.

---

# 42. What Happens During a Long Offline Period?

The POS can continue operating, but the business must define rules around:

- Stale product data.
- Stale prices.
- Inventory uncertainty.
- Cashier authorization.
- Offline transaction limits.
- Maximum offline duration.
- Storage limits.
- Conflict resolution.

Offline-first does not mean unlimited offline operation without business controls.

---

# 43. Browser Storage Considerations

IndexedDB is persistent browser storage, but it is still subject to browser/device storage policies.

The application should therefore:

- Avoid storing unnecessary large data.
- Monitor storage usage where practical.
- Avoid storing huge images locally unless needed.
- Keep synchronization efficient.
- Clean up old temporary data.
- Handle storage errors gracefully.

---

# 44. Service Worker Updates

The Service Worker must also support application updates.

The intended configuration uses:

```text
registerType: 'autoUpdate'
```

When a new frontend version is deployed, the Service Worker can obtain the updated application assets.

The application should still handle cases where an update is waiting or where a browser needs to reload before the newest version is active.

---

# 45. Render / Backend Deployment Context

The backend can be hosted on a service such as Render.

The important architectural distinction is:

```text
Render / Express
       ↓
Central API
       ↓
PostgreSQL
```

while the POS terminal remains capable of operating locally:

```text
React/Vite PWA
       ↓
IndexedDB
```

The frontend should therefore not assume that the Render server is available for every POS operation.

The API is essential for synchronization and centralized management, but not for every offline sale.

---

# 46. Recommended Development Sequence

The implementation should be built in stages rather than attempting the entire system at once.

## Stage 1 — Basic POS

Build:

- Product list
- Product search
- Cart
- Checkout
- Payment
- Receipt

## Stage 2 — Barcode Scanner

Add:

```text
Scanner → Barcode Listener → Product Lookup → Cart
```

Test with a real USB scanner.

## Stage 3 — PWA

Add:

- `vite-plugin-pwa`
- Service Worker
- Manifest
- Icons
- Offline application shell

Test that the application itself opens without internet.

## Stage 4 — IndexedDB

Add Dexie and move persistent local business data into IndexedDB.

Start with:

```text
Products
Sales
Sale Items
Settings
```

## Stage 5 — Local Sales

Make checkout save locally before attempting synchronization.

## Stage 6 — Sync Queue

Add:

```text
syncQueue
```

and queue every transaction requiring server synchronization.

## Stage 7 — Backend Sync

Implement:

```text
POST /api/sync/push
GET  /api/sync/changes
```

with idempotency.

## Stage 8 — Inventory

Add movement-based inventory synchronization.

## Stage 9 — Authentication and Audit

Implement controlled offline authentication and audit logging.

## Stage 10 — Multi-Terminal Testing

Test multiple terminals operating simultaneously, including periods when they are disconnected.

---

# 47. Testing Strategy

The most important test is the complete offline lifecycle.

## Test A — First Initialization

```text
1. Start with internet.
2. Open POS.
3. Confirm Service Worker installs.
4. Confirm products synchronize.
5. Confirm IndexedDB contains products.
```

## Test B — Offline Application

```text
1. Disconnect internet.
2. Close browser.
3. Reopen POS.
4. Confirm application loads.
```

## Test C — Offline Barcode

```text
1. Scan a known barcode.
2. Confirm product is found locally.
3. Confirm product enters cart.
```

## Test D — Offline Sale

```text
1. Add products.
2. Complete payment.
3. Save sale.
4. Confirm sale exists in IndexedDB.
```

## Test E — Browser Restart

```text
1. Close browser.
2. Reopen POS.
3. Confirm sale still exists.
```

## Test F — Synchronization

```text
1. Reconnect internet.
2. Confirm API becomes reachable.
3. Confirm pending sale is uploaded.
4. Confirm server stores it once.
5. Confirm local sale becomes synced.
```

## Test G — Failed Response / Retry

Simulate:

```text
Server saves transaction
       ↓
Response is lost
       ↓
POS retries
```

Confirm the server does not create a duplicate because of the unique client transaction ID.

---

# 48. Core Architectural Principles

The final architecture is based on these principles:

### 1. Scan locally

Do not require a server round trip for every barcode.

### 2. Sell locally

Checkout should work without internet.

### 3. Store locally

Sales should be written to IndexedDB immediately.

### 4. Queue synchronization

Pending operations should have explicit queue entries.

### 5. Synchronize later

When connectivity returns, push queued transactions.

### 6. Make synchronization idempotent

Retries must not create duplicate transactions.

### 7. Pull changes incrementally

Use synchronization cursors/change logs rather than downloading the entire database repeatedly.

### 8. Treat inventory as movements

This reduces conflicts between multiple offline terminals.

### 9. Track device and cashier

Every transaction should be traceable.

### 10. Separate UI state from persistent data

Redux handles current UI/application state; IndexedDB handles local persistence.

### 11. Keep the application shell offline

The Service Worker/PWA makes the application itself available without internet.

### 12. Make freshness visible

The POS should clearly communicate online/offline state and last synchronization time.

---

# 49. Final Architecture

The evolved solution can be summarized as:

```text
                        CENTRAL SYSTEM
                 ┌─────────────────────────┐
                 │       PostgreSQL        │
                 │ Products                │
                 │ Sales                   │
                 │ Inventory               │
                 │ Users                   │
                 │ Audit                   │
                 └────────────▲────────────┘
                              │
                              │
                 ┌────────────┴────────────┐
                 │      Express API        │
                 │ Auth / Business Rules   │
                 │ Sync / Idempotency      │
                 └────────────▲────────────┘
                              │
                        Internet
                              │
              ┌───────────────┴───────────────┐
              │                               │
       ┌──────┴─────────┐             ┌───────┴────────┐
       │    POS #1      │             │     POS #2     │
       │                │             │                │
       │ React + Vite   │             │ React + Vite   │
       │ PWA            │             │ PWA            │
       │ Redux          │             │ Redux          │
       │ IndexedDB      │             │ IndexedDB      │
       │ Sync Queue     │             │ Sync Queue     │
       └───────▲────────┘             └────────▲───────┘
               │                              │
        USB Barcode Scanner            USB Barcode Scanner
```

---

# 50. Final Mental Model

The simplest way to understand the entire solution is:

```text
                     POS TERMINAL

Scanner
   ↓
React POS
   ↓
Redux ───────────────→ Current UI / Cart
   │
   ↓
IndexedDB ───────────→ Local Products / Sales / Queue
   │
   ↓
Sync Engine
   │
   │ Internet available
   ↓
Express API
   ↓
PostgreSQL
```

When the internet is available:

```text
Local POS ↔ Central Server
```

When the internet disappears:

```text
Local POS
   ↓
IndexedDB
```

When the internet returns:

```text
IndexedDB
   ↓
Sync Queue
   ↓
Express
   ↓
PostgreSQL
```

That is the fundamental evolution of the project:

> **The POS is a local-first application that happens to synchronize with a central server, rather than an online application that happens to have some offline caching.**

This distinction is important because it determines how checkout, barcode scanning, persistence, synchronization, inventory, authentication, and error handling should all be implemented.
