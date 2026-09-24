import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { createSale, getTodaySales } from '../db/repos'
import { api, clearSession, getDeviceId, getStoredUser, getToken, normalizeCategory, setSession, type AppNotification, type ProductCategory, type PurchasingRecord } from '../lib/api'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { playPushChime, usePush } from '../hooks/usePush'
import { useSyncStatus } from '../hooks/useSyncStatus'
import { runSyncCycle } from '../services/sync'
import { cartTotals, useCart } from '../store/cart'
import { PAYMENT_LABELS, type Bike, type LocalSale, type PaymentMethod, type Product } from '../lib/types'
import { ugx } from '../lib/format'
import CheckoutModal from './CheckoutModal'
import ReceiptModal from './ReceiptModal'
import HistoryModal from './HistoryModal'
import CreditModal, { creditBadgeCounts } from './CreditModal'
import ReceivingScreen from './ReceivingScreen'
import ReceiveSelectModal from './ReceiveSelectModal'
import ReservationsModal from './ReservationsModal'
import { cn } from '../lib/cn'

// Permission sets that decide which toolbar/header entries render at all
// (hide-not-disable). Same ids as server/src/permissions/catalog.js — the
// server re-checks on every request; this only decides what the terminal offers.
const RESERVATION_PERMS = ['reservation_create', 'installment_collect', 'reservation_complete', 'reservation_release'] as const
const REORDER_PERMS = ['reorder_create', 'reorder_manage'] as const
const CREDIT_DESK_PERMS = ['credit_request', 'credit_finalize', 'credit_settle'] as const

export default function POSScreen() {
  const user = getStoredUser()!
  const sync = useSyncStatus()
  const cart = useCart()
  const [search, setSearch] = useState('')
  const [major, setMajor] = useState<'ice' | 'ebikes' | 'ebikeparts'>('ice')
  const [category, setCategory] = useState<string>('All')
  // Three major catalogue tabs at the same level, each wired to the canonical
  // database categories via normalizeCategory: the I.C.E group (spare parts,
  // accessories, consumables), the e-Bikes themselves, and e-Bike spare parts.
  const iceCategories = ['Spare Parts', 'Accessories', 'Consumables'] as const
  const MAJOR_SCOPE = {
    ice: iceCategories,
    ebikes: ['e-Bikes'] as const,
    ebikeparts: ['e-Bikes Spare Parts'] as const,
  }
  // Sub-pills only refine the I.C.E tab; the other tabs map to a single
  // database category each. Labels use the singular floor terms.
  const iceSubPills = [
    { label: 'All', value: 'All' },
    { label: 'Spare Part', value: 'Spare Parts' },
    { label: 'Accessory', value: 'Accessories' },
    { label: 'Consumable', value: 'Consumables' },
  ] as const
  const showBikes = major === 'ebikes'
  const [showCheckout, setShowCheckout] = useState(false)
  const [receipt, setReceipt] = useState<LocalSale | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [stockMode, setStockMode] = useState<'receive-select' | 'reorder' | 'receive' | null>(null)
  const [sourceList, setSourceList] = useState<PurchasingRecord | null>(null)
  const [showReservations, setShowReservations] = useState(false)
  const [reserveBike, setReserveBike] = useState<Bike | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [canReceive, setCanReceive] = useState(false)
  // Enforced capability set (role baseline ∪ admin grants) as reported by the
  // server. Refreshed on mount so a grant/revoke made on the Team page appears
  // without a re-login; the server re-checks every request regardless.
  const [perms, setPerms] = useState<string[]>(user.effective_permissions || [])
  const hasPerm = useCallback((permission: string) => perms.includes(permission), [perms])
  const hasAnyPerm = useCallback((ids: readonly string[]) => ids.some((id) => perms.includes(id)), [perms])
  // Entry-point visibility: a user only sees what they can act on. Individual
  // actions (Finalize, Complete, Release…) stay gated inside their screens.
  const canReserve = hasAnyPerm(RESERVATION_PERMS)
  const canReorder = hasAnyPerm(REORDER_PERMS)
  const canCreditDesk = hasAnyPerm(CREDIT_DESK_PERMS)
  const [reorderCount, setReorderCount] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [showCredit, setShowCredit] = useState(false)
  const [creditBadge, setCreditBadge] = useState({ awaiting: 0, approved: 0, rejected: 0 })
  const [creditNote, setCreditNote] = useState<string | null>(null)
  // Durable inbox bell (shared `notifications` table, scoped to this user).
  const [notifUnread, setNotifUnread] = useState(0)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  // Stable identity so CreditModal's load callback (and its refresh timer) don't reset every render.
  const refreshBadge = useCallback(
    (counts: { awaiting: number; approved: number; rejected: number }) => setCreditBadge(counts),
    [],
  )
  const push = usePush()
  // User-gesture unlock for the in-app chime: browsers block AudioContext
  // until the first interaction, so the first click/key arms the
  // credit-decision beep (same pattern as the admin dashboard shell).
  const audioArmed = useRef(false)
  useEffect(() => {
    const arm = () => {
      audioArmed.current = true
    }
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  // Stock-in capability is per role / grant (managers hold it; an operator only
  // when the admin granted `inventory_receive`). The same round trip refreshes
  // the whole capability set so manager-only screens (reservations) show up.
  useEffect(() => {
    api.purchasingCatalog()
      .then((r) => setCanReceive(r.can_receive))
      .catch(() => setCanReceive(false))
    api
      .me()
      .then((r) => {
        setPerms(r.user.effective_permissions || [])
        const token = getToken()
        if (token) setSession(token, r.user)
      })
      .catch(() => {
        /* offline — keep the capabilities we logged in with */
      })
  }, [])

  // Count of pending + processed reorder lists for the notification badge.
  // Fulfilled (already received) lists are not included; cancelled lists are gone.
  // Skipped (and cleared) unless the user can open reorder lists at all — no
  // pointless 403s from a restricted terminal.
  useEffect(() => {
    if (!canReorder) { setReorderCount(0); return }
    api.reorderCounts()
      .then((r) => {
        const attention = r.counts.pending + r.counts.processed
        setReorderCount(attention > 0 ? attention : 0)
      })
      .catch(() => setReorderCount(0))
    }, [canReorder])

  // Credit bell — polling fallback for approval decisions (works when push is
  // blocked): keeps the header badge fresh and toasts NEW decisions only. The
  // last-seen decision timestamp is baselined on first run so history never toasts.
  useEffect(() => {
    // No credit permissions → no desk, no polling, no badge.
    if (!canCreditDesk) {
      setCreditBadge({ awaiting: 0, approved: 0, rejected: 0 })
      return
    }
    let cancelled = false
    async function pollCredit() {
      if (!sync.online) return
      try {
        const since = localStorage.getItem('spiro_credit_seen')
        const [{ pending }, { decisions }] = await Promise.all([api.creditSales(), api.creditStatus()])
        if (cancelled) return
        // Badge comes entirely from the pending list: rejected-but-unconfirmed
        // rows are server-persisted inside it, right next to the approved ones.
        setCreditBadge(creditBadgeCounts(pending))
        // New since our baseline (ISO strings compare lexicographically).
        const fresh = since ? decisions.filter((d) => d.decided_at > since) : []
        if (fresh.length > 0) {
          const d = fresh[0] // newest first
          setCreditNote(
            d.decision === 'approved'
              ? `Credit ${d.receipt_no} approved — open Credit to finalize`
              : `Credit ${d.receipt_no} rejected — confirm in the Credit desk, do not release the goods`,
          )
          // Fallback path (push blocked/offline at decision time): same beep,
          // and it can't double-fire with the push — that path advanced the baseline.
          if (audioArmed.current) playPushChime()
        }
        if (decisions.length > 0) {
          localStorage.setItem('spiro_credit_seen', decisions[0].decided_at)
        } else if (!since) {
          localStorage.setItem('spiro_credit_seen', new Date().toISOString())
        }
      } catch {
        /* offline or forbidden — badge stays as-is */
      }
    }
    void pollCredit()
    const id = setInterval(pollCredit, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sync.online, canCreditDesk])

  const products = useLiveQuery(() => db.products.toArray(), [])
  const bikes = useLiveQuery(() => db.bikes.where('status').equals('in_stock').toArray(), [])
  const todays = useLiveQuery(() => getTodaySales(), [])

  const todayStats = useMemo(() => {
    const list = todays || []
    return {
      count: list.length,
      // Credit sales are never revenue at checkout — the debt only opens on
      // Finalize, and only settlement payments count as revenue server-side.
      revenue: list.filter((x) => x.payment_method !== 'credit').reduce((s, x) => s + x.total, 0),
      pending: list.filter((x) => x.status === 'pending_sync').length,
    }
  }, [todays])

  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Each major tab maps onto the canonical database categories; a product
    // can only surface under the tab that owns its category.
    const scope: readonly ProductCategory[] = MAJOR_SCOPE[major]
    return (products || []).filter(
      (p) =>
        // normalizeCategory maps legacy values ('Spare part', 'I.C.E Bike Spare
        // Parts', 'e-Bike', …) onto the canonical set so pre-migration offline
        // stock still shows under the right section.
        scope.includes(normalizeCategory(p.category) as ProductCategory) &&
        (major !== 'ice' || category === 'All' || normalizeCategory(p.category) === category) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '').includes(q)),
    )
  }, [products, search, category, major])

  const filteredBikes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (bikes || []).filter((b) => !q || b.model.toLowerCase().includes(q) || b.vin.toLowerCase().includes(q))
  }, [bikes, search])

  const addProduct = useCallback(
    (p: Product, qty = 1) => {
      cart.addItem({ kind: 'part', id: p.id, name: p.name, sku: p.sku, unit_price: Number(p.selling_price), unit_cost: Number(p.cost_price), stock_qty: p.stock_qty }, qty)
      setFlash(`${p.name} added`)
    },
    [cart],
  )

  const addBike = useCallback(
    (b: Bike) => {
      cart.addItem({ kind: 'bike', id: b.id, name: `${b.model}${b.color ? ` · ${b.color}` : ''}`, sku: b.vin, unit_price: Number(b.selling_price), unit_cost: Number(b.cost_price), stock_qty: 1 })
      setFlash(`${b.model} added`)
    },
    [cart],
  )

  // Barcode scanner — local IndexedDB lookup (never a network round trip).
  // Wired to the HID-keyboard scanner service (types fast + Enter).
  const handleScan = useCallback(
    async (code: string) => {
      const p = await db.products.where('barcode').equals(code).first()
      if (p) {
        addProduct(p)
        return
      }
      const b = await db.bikes.where('vin').equals(code).first()
      if (b && b.status === 'in_stock') {
        addBike(b)
        return
      }
      setSearch(code) // fall back to manual search
      setFlash(`No product with barcode ${code}`)
    },
    [addProduct, addBike],
  )
  useBarcodeScanner(handleScan)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    if (!creditNote) return
    const t = setTimeout(() => setCreditNote(null), 6000)
    return () => clearTimeout(t)
  }, [creditNote])

  // Surface push-subscription failures as a toast (the account popup shows
  // the same message persistently) — enabling alerts must never fail silently.
  useEffect(() => {
    if (push.error) setFlash(push.error)
  }, [push.error])

  // Web Push while the POS is open: the service worker forwards every push to
  // the page. Credit decisions (creditEvent) raise the bell toast and refresh
  // the header badge instantly — the 30s poll stays as the fallback for when
  // push is blocked or the terminal was offline at decision time.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const payload = e.data?.type === 'PUSH'
        ? (e.data.payload as { creditEvent?: boolean; title?: string; body?: string } | undefined)
        : null
      if (!payload) return
      if (payload.creditEvent) {
        setCreditNote(payload.body || payload.title || 'Credit sale decision received')
        // Beep the operator the moment the decision lands (armed on first gesture).
        if (audioArmed.current) playPushChime()
        // Advance the poll baseline so the 30s fallback doesn't toast it twice.
        localStorage.setItem('spiro_credit_seen', new Date().toISOString())
        void api
          .creditSales()
          .then((r) => setCreditBadge(creditBadgeCounts(r.pending)))
          .catch(() => {})
      } else if (payload.title) {
        setFlash(payload.title)
      }
      // Every push lands an inbox row — recount the bell immediately.
      void api.unreadCount().then((r) => setNotifUnread(r.unread_count)).catch(() => {})
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  // Inbox badge: poll (30s, mirrors the credit poll — kiosk-safe, no dialogs)
  // plus the instant refetch on every incoming push above.
  useEffect(() => {
    const poll = () => void api.unreadCount().then((r) => setNotifUnread(r.unread_count)).catch(() => {})
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [])

  async function openNotifs() {
    const next = !showNotifs
    setShowNotifs(next)
    if (!next) return
    setNotifLoading(true)
    try {
      const r = await api.notifications()
      setNotifs(r.notifications)
      setNotifUnread(r.unread_count)
    } catch {
      /* offline — keep what we had */
    }
    setNotifLoading(false)
  }

  async function clickNotif(n: AppNotification) {
    if (!n.read_at) {
      setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      setNotifUnread((c) => Math.max(0, c - 1))
      try { await api.markNotificationRead(n.id) } catch { /* next poll reconciles */ }
    }
    setShowNotifs(false)
    // Single-screen app: no deep-linking — just acknowledge the headline.
    setFlash(n.title)
  }

  async function readAllNotifs() {
    const now = new Date().toISOString()
    setNotifs((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: now })))
    setNotifUnread(0)
    try { await api.markAllNotificationsRead() } catch { /* non-fatal */ }
  }

  const totals = cartTotals(cart.items)

  // Discounts are admin-only, so the checkout payload never carries one.
  // Stock-in / reservations below are gated on the capability set the server
  // computes for this user (role baseline ∪ admin grants).
  async function completeCheckout(input: { payment_method: PaymentMethod; amount_paid: number; customer_name: string | null; customer_phone: string | null }) {
    const sale = await createSale({
      cashier_id: user.id,
      cashier_name: user.full_name,
      device_id: getDeviceId(),
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      payment_method: input.payment_method,
      amount_paid: input.amount_paid,
      items: cart.items.map((i) => ({
        product_id: i.kind === 'part' ? i.id : null,
        bike_id: i.kind === 'bike' ? i.id : null,
        name: i.name,
        kind: i.kind,
        qty: i.qty,
        unit_price: i.unit_price,
        unit_cost: i.unit_cost,
        line_total: i.unit_price * i.qty,
      })),
    })

    // Optimistic local stock deduction so the UI reflects reality offline.
    // Credit sales are EXCLUDED: stock only moves when the operator clicks
    // Finalize after admin approval (the server guards sold-out with a 409).
    if (input.payment_method !== 'credit') {
      for (const i of cart.items) {
        if (i.kind === 'part') {
          await db.products.where('id').equals(i.id).modify((p: Product) => {
            p.stock_qty = Math.max(0, p.stock_qty - i.qty)
          })
        } else {
          await db.bikes.where('id').equals(i.id).modify((b: Bike) => {
            b.status = 'sold'
          })
        }
      }
    }

    cart.clearCart()
    setShowCheckout(false)
    setReceipt(sale)
    // Fire an immediate sync attempt (works when online; harmless when offline)
    void runSyncCycle('after-sale')
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <header className="h-14 shrink-0 border-b border-slate-800/70 flex items-center px-4 gap-4 bg-[#0e1512]">
        <button type="button" onClick={() => setShowAccount(true)} title="Account" className="rounded-lg hover:opacity-80">
          <img src="/logo.png" alt="Spiro" className="h-8 w-8 object-contain" />
        </button>
        <div>
          <div className="text-sm font-bold text-white leading-tight">Spiro POS</div>
          <div className="text-[10px] text-slate-500">{getDeviceId()} · {user.full_name}</div>
        </div>

        <div
          className={cn(
            'ml-6 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border',
            sync.online ? 'bg-brand-500/10 text-brand-300 border-brand-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', sync.online ? 'bg-brand-400' : 'bg-amber-400 animate-pulse')} />
          {sync.online ? 'Online' : 'Offline — selling continues'}
        </div>

        {sync.pendingCount > 0 && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full font-semibold">
            {sync.pendingCount} sale{sync.pendingCount > 1 ? 's' : ''} queued for sync
          </div>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span>Today: <span className="text-white font-semibold">{todayStats.count}</span> sales · <span className="text-brand-300 font-semibold">{ugx(todayStats.revenue)}</span></span>
          {push.state !== 'subscribed' && push.state !== 'unsupported' && (
            <button
              className="btn-ghost text-xs"
              disabled={push.busy}
              title={
                push.state === 'denied'
                  ? 'Notifications are blocked in the browser — allow them via the address-bar lock icon, then retry'
                  : 'Get an OS notification for credit decisions, release outcomes, installments and permission grants'
              }
              onClick={() => {
                void push.enable().then((ok) => {
                  if (ok) setFlash('Alerts on — you’ll be pinged the moment a decision or grant lands')
                })
              }}
            >
              {push.busy ? 'Enabling…' : push.state === 'denied' ? 'Alerts blocked' : 'Enable alerts'}
            </button>
          )}
          {/* Durable inbox bell */}
          <div className="relative">
            <button
              type="button"
              className="btn-ghost text-xs relative"
              onClick={() => void openNotifs()}
              title={notifUnread > 0 ? `${notifUnread} unread notification${notifUnread === 1 ? '' : 's'}` : 'Notifications'}
              aria-label="Notifications"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notifUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full bg-brand-500 ring-1 ring-slate-800">
                  {notifUnread > 99 ? '99+' : notifUnread}
                </span>
              )}
            </button>
            {showNotifs && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                <div className="absolute right-0 top-full mt-2 w-[300px] max-h-[70vh] overflow-y-auto card p-2 z-50 shadow-2xl">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold text-white uppercase tracking-wider">Notifications</span>
                    <button type="button" className="text-[11px] text-brand-300 hover:text-brand-200" onClick={() => void readAllNotifs()}>
                      Mark all read
                    </button>
                  </div>
                  {notifLoading ? (
                    <p className="text-xs text-slate-500 px-2 py-3">Loading…</p>
                  ) : notifs.length === 0 ? (
                    <p className="text-xs text-slate-500 px-2 py-3">Nothing yet — credit decisions, release outcomes and permission grants land here.</p>
                  ) : (
                    <div className="space-y-1">
                      {notifs.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => void clickNotif(n)}
                          className={cn('w-full text-left rounded-lg px-2.5 py-2 transition', n.read_at ? 'opacity-60' : 'bg-brand-500/10 hover:bg-brand-500/20')}
                        >
                          <div className="flex items-start gap-2">
                            {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />}
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{n.title}</div>
                              <div className="text-[11px] text-slate-400 leading-snug">{n.body}</div>
                              <div className="text-[10px] text-slate-600 mt-0.5">
                                {new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {canCreditDesk && (
            <button
              className="btn-ghost text-xs relative"
              onClick={() => setShowCredit(true)}
              title={
                creditBadge.approved > 0
                  ? `${creditBadge.approved} approved — ready to finalize`
                  : creditBadge.rejected > 0
                    ? `${creditBadge.rejected} rejected — confirm receipt in the Credit desk`
                    : creditBadge.awaiting > 0
                      ? `${creditBadge.awaiting} credit sale(s) awaiting approval`
                      : 'Credit desk — queue, finalize & settlements'
              }
            >
              Credit
              {(creditBadge.approved > 0 || creditBadge.rejected > 0 || creditBadge.awaiting > 0) && (
                <span
                  className={cn(
                    'absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-800',
                    creditBadge.approved > 0
                      ? 'bg-brand-500'
                      : creditBadge.rejected > 0
                        ? 'bg-red-500'
                        : 'bg-amber-500',
                  )}
                >
                  {creditBadge.approved > 0
                    ? creditBadge.approved
                    : creditBadge.rejected > 0
                      ? creditBadge.rejected
                      : creditBadge.awaiting}
                </span>
              )}
            </button>
          )}
          {canReserve && (
            <button
              className="btn-ghost text-xs"
              onClick={() => { setReserveBike(null); setShowReservations(true) }}
              title="Bike reservations — browse, take down payments, collect installments, complete or release"
            >
              Reservations
            </button>
          )}
          <button className="btn-ghost text-xs" onClick={() => setShowHistory(true)}>History</button>
          <button className="btn-ghost text-xs" onClick={() => void runSyncCycle('manual')} disabled={sync.syncing}>
            {sync.syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: catalog */}
        <section className="flex-1 flex flex-col min-w-0 p-4 gap-3">
          {/* Major catalogue tabs sit above the search bar. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2 w-fit">
              <button className={cn('btn text-xs', major === 'ice' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setMajor('ice'); setCategory('All') }}>Bajaj Spare Parts &amp; Accessories</button>
              <button className={cn('btn text-xs', major === 'ebikes' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setMajor('ebikes'); setCategory('All') }}>e-Bikes</button>
              <button className={cn('btn text-xs', major === 'ebikeparts' ? 'btn-primary' : 'btn-ghost')} onClick={() => { setMajor('ebikeparts'); setCategory('All') }}>Spiro Spare Parts</button>
            </div>
            <div className="flex items-center gap-2">
              {canReceive && (
                <button className="btn-ghost text-xs" onClick={() => setStockMode('receive-select')}>Receive stock</button>
              )}
              {canReorder && (
                <button className="btn-ghost text-xs relative" onClick={() => setStockMode('reorder')}>
                  Reorder list
                  {reorderCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-white bg-orange-500 rounded-full ring-1 ring-slate-800">
                      {reorderCount > 9 ? '9+' : reorderCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
          <input
            className="input"
            placeholder="Search name / SKU / VIN — or just scan a barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Sub-pills refine the I.C.E tab only; the other tabs map to a single database category. */}
          {major === 'ice' && (
            <div className="flex gap-1.5 flex-wrap">
              {iceSubPills.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setCategory(s.value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition whitespace-nowrap',
                    category === s.value ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'text-slate-400 border-slate-800 hover:border-slate-600',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
            {showBikes ? (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
                {filteredBikes.map((b) => (
                  <div key={b.id} className="card p-4 hover:border-brand-500/50 transition flex flex-col">
                    <button className="text-left flex-1" onClick={() => addBike(b)}>
                      <div className="text-sm font-bold text-white">{b.model}</div>
                      <div className="text-xs text-slate-500">{b.color} {b.year ? `· ${b.year}` : ''}</div>
                      <div className="text-[10px] font-mono text-slate-600 mt-1">{b.vin}</div>
                      <div className="text-brand-300 font-bold mt-2">{ugx(b.selling_price)}</div>
                      {b.battery_spec && <div className="text-[10px] text-slate-500 mt-1">🔋 {b.battery_spec}</div>}
                    </button>
                    {/* Reservations are manager work: a plain operator only sees
                        this when the admin granted `reservation_create`. */}
                    {hasPerm('reservation_create') && (
                      <button
                        className="mt-3 w-full text-xs font-semibold px-2 py-1.5 rounded-lg border border-brand-500/40 text-brand-300 hover:bg-brand-500/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={!sync.online}
                        title={sync.online ? 'Take a down payment and reserve this bike on an installment plan' : 'Reservations need a connection'}
                        onClick={() => { setReserveBike(b); setShowReservations(true) }}
                      >
                        Reserve · down payment
                      </button>
                    )}
                  </div>
                ))}
                {filteredBikes.length === 0 && <div className="col-span-full text-center text-sm text-slate-600 py-10">No bikes available in local catalog.</div>}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {filteredParts.map((p) => {
                  const out = p.stock_qty <= 0
                  return (
                    <button
                      key={p.id}
                      disabled={out}
                      onClick={() => addProduct(p)}
                      className={cn(
                        'card p-3 text-left hover:border-brand-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed',
                        out && 'hover:border-slate-800',
                      )}
                    >
                      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{p.category}</div>
                      <div className="text-sm font-semibold text-white mt-0.5 leading-snug line-clamp-2">{p.name}</div>
                      <div className="flex items-end justify-between mt-2">
                        <span className="text-brand-300 font-bold text-sm">{ugx(p.selling_price)}</span>
                        {/* Worded stock level: red Out / amber at-below reorder level, slate otherwise. */}
                        <span
                          title={out ? 'Out of stock' : `${p.stock_qty} in stock${p.stock_qty <= p.reorder_level ? ' (low)' : ''}`}
                          className={cn(
                            'text-[10px] font-medium shrink-0',
                            out
                              ? 'text-red-400'
                              : p.stock_qty <= p.reorder_level
                                ? 'text-orange-400'
                                : 'text-slate-500',
                          )}
                        >
                          {out ? 'Out of stock' : `${p.stock_qty} in stock`}
                        </span>
                      </div>
                    </button>
                  )
                })}
                {filteredParts.length === 0 && <div className="col-span-full text-center text-sm text-slate-600 py-10">No products match. Sync when online to refresh catalog.</div>}
              </div>
            )}
          </div>
        </section>

        {/* Right: cart */}
        <aside className="w-[380px] shrink-0 border-l border-slate-800/70 bg-[#0e1512] flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800/70 flex items-center justify-between">
            <h2 className="font-semibold text-white text-sm">Cart · {cart.items.length} item{cart.items.length !== 1 ? 's' : ''}</h2>
            {cart.items.length > 0 && <button className="text-xs text-slate-500 hover:text-red-300" onClick={() => cart.clearCart()}>Clear</button>}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.items.length === 0 && (
              <div className="text-center text-sm text-slate-600 py-12">
                Scan a barcode or tap a product
                <div className="text-xs mt-2 text-slate-700">Scanner input lands here automatically</div>
              </div>
            )}
            {cart.items.map((i) => (
              <div key={i.key} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{i.name}</div>
                    {i.sku && <div className="text-[10px] font-mono text-slate-500">{i.sku}</div>}
                  </div>
                  <button className="text-slate-600 hover:text-red-400 text-xs" onClick={() => cart.removeItem(i.key)}>×</button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  {i.kind === 'bike' ? (
                    <span className="text-xs text-slate-500">Qty 1 (serialized)</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button className="h-6 w-6 rounded-md bg-slate-800 text-slate-300 text-sm leading-none" onClick={() => cart.setQty(i.key, i.qty - 1)}>−</button>
                      <span className="w-8 text-center text-sm font-semibold">{i.qty}</span>
                      <button
                        className="h-6 w-6 rounded-md bg-slate-800 text-slate-300 text-sm leading-none disabled:opacity-30"
                        disabled={i.qty >= i.stock_qty}
                        onClick={() => cart.setQty(i.key, i.qty + 1)}
                      >+</button>
                    </div>
                  )}
                  <span className="text-sm font-bold text-brand-300">{ugx(i.unit_price * i.qty)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800/70 p-4 space-y-2">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Subtotal</span><span>{ugx(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-white pt-1 border-t border-slate-800/60">
              <span>Total</span><span>{ugx(totals.total)}</span>
            </div>
            <button className="btn-primary w-full" disabled={cart.items.length === 0} onClick={() => setShowCheckout(true)}>
              Checkout · {PAYMENT_LABELS[cart.paymentMethod]}
            </button>
          </div>
        </aside>
      </div>

      {/* Toast */}
      {flash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111814] border border-brand-500/40 text-brand-200 text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {flash}
        </div>
      )}

      {/* Credit decision toast — tap to open the desk */}
      {creditNote && (
        <button
          className="fixed bottom-16 left-1/2 -translate-x-1/2 max-w-md bg-[#111814] border border-sky-500/40 text-sky-200 text-sm px-4 py-2.5 rounded-xl shadow-lg z-50 text-left"
          onClick={() => {
            setShowCredit(true)
            setCreditNote(null)
          }}
        >
          {creditNote} <span className="underline underline-offset-2">Open Credit →</span>
        </button>
      )}

      {/* Account popup (logo click) */}
      {showAccount && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4" onClick={() => setShowAccount(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative card w-full max-w-xs p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <img src="/logo.png" alt="Spiro" className="h-12 w-12 object-contain mx-auto" />
            <div className="text-sm font-semibold text-white mt-2">{user.full_name}</div>
            <div className="text-[11px] text-slate-500">{getDeviceId()}</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Alerts:{' '}
              {push.state === 'subscribed'
                ? '✓ on — decisions, releases & grants arrive as notifications'
                : push.state === 'denied'
                  ? 'blocked in browser settings'
                  : push.state === 'unsupported'
                    ? 'not supported on this device'
                    : 'off'}
            </div>
            {push.error && <div className="text-[11px] text-red-400 mt-1">{push.error}</div>}
            <button
              className="btn-danger w-full mt-4"
              onClick={() => { setShowAccount(false); clearSession(); location.reload() }}
            >
              Sign out
            </button>
            <button className="btn-ghost w-full mt-2" onClick={() => setShowAccount(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showCheckout && (
        <CheckoutModal
          totals={totals}
          onClose={() => setShowCheckout(false)}
          onComplete={completeCheckout}
        />
      )}

      {receipt && <ReceiptModal sale={receipt} onClose={() => setReceipt(null)} />}

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}

      {showCredit && canCreditDesk && (
        <CreditModal
          online={sync.online}
          onClose={() => setShowCredit(false)}
          onBadge={refreshBadge}
          onFlash={(msg) => setFlash(msg)}
        />
      )}

      {showReservations && canReserve && (
        <ReservationsModal
          prefillBike={reserveBike}
          onClose={() => { setShowReservations(false); setReserveBike(null) }}
          onFlash={(msg) => {
            setFlash(msg)
            void runSyncCycle('after-reservation')
          }}
        />
      )}

      {stockMode === 'receive-select' && canReceive && (
        <ReceiveSelectModal
          onClose={() => setStockMode(null)}
          onSelect={(r) => { setSourceList(r); setStockMode('receive') }}
          onNew={() => { setSourceList(null); setStockMode('receive') }}
        />
      )}

      {stockMode === 'receive' && canReceive && (
        <ReceivingScreen
          key={'receive-' + (sourceList?.id || 'new')}
          mode="receive"
          canReceive={canReceive}
          sourceList={sourceList || undefined}
          onClose={() => { setStockMode(null); setSourceList(null) }}
          onDone={(message) => {
            setStockMode(null); setSourceList(null); setFlash(message)
            void runSyncCycle('after-receive')
            // Refresh the reorder-list badge count — only pending + processed count.
            // Skipped when the user cannot open reorder lists (no permission → 403).
            if (canReorder) {
              api.reorderCounts()
                .then((r) => {
                  const attention = r.counts.pending + r.counts.processed
                  setReorderCount(attention > 0 ? attention : 0)
                })
                .catch(() => setReorderCount(0))
            } else {
              setReorderCount(0)
            }
          }}
        />
      )}

      {stockMode === 'reorder' && canReorder && (
        <ReceivingScreen
          mode="reorder"
          canReceive={canReceive}
          onClose={() => setStockMode(null)}
          onDone={(message) => { setStockMode(null); setFlash(message); void runSyncCycle('after-receive') }}
        />
      )}
    </div>
  )
}

