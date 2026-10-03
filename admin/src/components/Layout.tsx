import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../lib/access'
import { playPushChime, usePush } from '../hooks/usePush'
import { useEvents } from '../hooks/useEvents'
import { api, type AppNotification } from '../lib/api'
import { ugx } from '../lib/format'
import { Modal } from './Modal'
import { showToast, ToastHost } from './Toaster'
import { cn } from '../lib/cn'

const NAV = [
  { to: '/', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10' },
  { to: '/sales', label: 'Sales', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 005.4 17H17M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z' },
  { to: '/credit', label: 'Credit', icon: 'M1 4h22v16H1zM1 10h22' },
  { to: '/inventory', label: 'Inventory', icon: 'M20 7l-8-4-8 4v10l8 4 8-4V7zM4 7l8 4m0 0l8-4m-8 4v10' },
  { to: '/purchasing', label: 'Purchasing', icon: 'M9 17V7m4 10V4m4 13v-6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { to: '/bikes', label: 'Bikes / VIN', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/customers', label: 'Customers', icon: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { to: '/team', label: 'Team & Codes', icon: 'M12 4.35a4 4 0 100 6.3 4 4 0 000-6.3zM5 21v-2a6 6 0 0114 0v2' },
  { to: '/approvals', label: 'Approvals', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/audit', label: 'Audit Trail', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0M9 5a2 2 0 014 0m-6 9l2 2 4-4' },
  // Gear icon (Feather settings) — reads unmistakably as a cog at 18px.
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z' },
]

function NavBadges({ badges }: { badges: Array<{ count: number | null; title: string; className: string }> }) {
  const visible = badges.filter((b) => b.count != null && b.count > 0)
  if (visible.length === 0) return null
  return (
    // Vertically centered with the label, flush to the nav row's right edge
    // (dropped down from top-right so the pills line up with the word).
    <span className="absolute top-1/2 -translate-y-1/2 right-1.5 flex gap-1">
      {visible.map((b) => (
        <span
          key={b.title}
          title={b.title}
          className={cn(
            // POS badge spec: solid colour pill, white text, ring for separation.
            'min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full ring-1 ring-slate-800',
            b.className,
          )}
        >
          {(b.count as number) > 99 ? '99+' : b.count}
        </span>
      ))}
    </span>
  )
}

/** Blinking orange beacon — something is awaiting approval (credit sale / discount). */
function Beacon() {
  return (
    <span className="relative flex h-3.5 w-3.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
      <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-amber-500 border border-amber-200/60" />
    </span>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const push = usePush()
  // The hook subscribes automatically; any one-time hint (iOS install, blocked
  // alerts) is surfaced as a toast instead of a button the user must find.
  useEffect(() => {
    if (!push.notice) return
    showToast('Notifications', push.notice)
    push.dismissNotice()
  }, [push.notice, push.dismissNotice])
  const navigate = useNavigate()
  const [showWipe, setShowWipe] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [wipeConfirm, setWipeConfirm] = useState('')
  const [wiping, setWiping] = useState(false)
  const [wipeError, setWipeError] = useState('')
  // User gesture unlock for in-app sound: browsers block AudioContext until
  // the user interacts. The first pointer interaction arms the chime so later
  // push toasts can beep; closed-tab delivery still beeps via the OS.
  const audioArmed = useRef(false)
  useEffect(() => {
    const arm = () => { audioArmed.current = true }
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])
  const [navOpen, setNavOpen] = useState(false)
  // Sidebar attention badges: pending reorder lists + pending approvals.
  // Loaded lazily alongside the shell so every page inherits them for free;
  // failures are swallowed so the nav never breaks when offline.
  const [reorderCount, setReorderCount] = useState<number | null>(null)
  const [approvalCount, setApprovalCount] = useState<number | null>(null)
  const [lowStockCount, setLowStockCount] = useState<number | null>(null)
  // Durable inbox bell (shared `notifications` table, scoped to this user).
  // Unread rows only — acknowledged rows are deleted from the DB.
  const [notifUnread, setNotifUnread] = useState(0)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  // Bell anchor for the ported popup: positioned from the button's rect so the
  // panel can live at the body level (always above page content, e.g. Approvals).
  const bellRef = useRef<HTMLButtonElement | null>(null)
  const [notifPanel, setNotifPanel] = useState<{ right: number; top: number } | null>(null)

  const loadBadges = useCallback(async () => {
    try {
      const counts = await api.reorderCounts().catch(() => ({ counts: { pending: 0, processed: 0, fulfilled: 0, cancelled: 0 } }))
      // Pending + Processing (not Fulfilled) = attention needed on the Reorder list button.
      // Fulfilled lists are already received and don't need a badge; cancelled lists
      // leave the set entirely.
      const attention = counts.counts.pending + counts.counts.processed
      setReorderCount(attention > 0 ? attention : null)
      const [approvals, lowStock, unread] = await Promise.all([
        api.approvals('pending').catch(() => ({ approvals: [] })),
        api.lowStock().catch(() => ({ products: [] })),
        api.unreadCount().catch(() => ({ unread_count: 0 })),
      ])
      setApprovalCount(approvals.approvals.length)
      setLowStockCount(lowStock.products.length)
      setNotifUnread(unread.unread_count)
    } catch {
      /* offline or forbidden — leave badges hidden */
    }
  }, [])

  useEffect(() => {
    void loadBadges()
    // 30s refresh stays as the fallback for when the SSE stream is unavailable.
    const id = setInterval(() => { void loadBadges() }, 30000)
    return () => clearInterval(id)
  }, [loadBadges])

  // Re-read the inbox list (used when the bell panel is open and a new row lands).
  const refreshNotifs = useCallback(async () => {
    try {
      const res = await api.notifications()
      setNotifs(res.notifications)
      setNotifUnread(res.unread_count)
    } catch {
      /* offline — keep whatever we had */
    }
  }, [])
  const showNotifsRef = useRef(false)
  useEffect(() => { showNotifsRef.current = showNotifs }, [showNotifs])

  // Live updates (Workstream D): one EventSource drives an instant badge recount
  // plus the matching targeted refetch — no page waits on the 30s poll.
  useEvents((type) => {
    if (type === 'ready') return
    void loadBadges()
    if (type === 'notification.created' && showNotifsRef.current) void refreshNotifs()
  })

  // In-app toast + chime when a push arrives (e.g. a POS sale) while the
  // dashboard is open. The chime only plays after a user gesture has armed
  // audio (see audioArmed) — browsers block sound before first interaction.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const payload = e.data?.payload
      if (e.data?.type !== 'PUSH' || !payload) return
      const isSale = payload.receiptNo || payload.title?.includes('Sale')
      // Toasts live in the shared host (Toaster.tsx) — same look/behaviour.
      showToast(payload.title || 'Spiro', payload.body || '')
      if (audioArmed.current) playPushChime()
      // A push always means a fresh inbox row landed — recount immediately.
      void api.unreadCount().then((r) => setNotifUnread(r.unread_count)).catch(() => {})
      if (isSale) console.log(`[sale] ${payload.receiptNo || ''} ${ugx(Number(payload.total) || 0)} via ${payload.paymentMethod || '—'}`)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

  // ---------- Notification bell (durable inbox shared with the POS) ----------
  async function openNotifs() {
    const next = !showNotifs
    setShowNotifs(next)
    if (!next) return
    // Anchor the ported panel to the bell's viewport rect (right/below).
    const r = bellRef.current?.getBoundingClientRect()
    if (r) setNotifPanel({ right: Math.max(8, Math.round(window.innerWidth - r.right)), top: Math.round(r.bottom + 8) })
    setNotifLoading(true)
    try {
      // Server returns unread rows only.
      const res = await api.notifications()
      setNotifs(res.notifications)
      setNotifUnread(res.unread_count)
    } catch {
      /* offline — keep whatever we had */
    }
    setNotifLoading(false)
  }

  async function clickNotif(n: AppNotification) {
    // Acknowledging deletes the row from the database (container is unread-only).
    setNotifs((prev) => prev.filter((x) => x.id !== n.id))
    setNotifUnread((c) => Math.max(0, c - 1))
    setShowNotifs(false)
    try { await api.deleteNotification(n.id) } catch { /* next poll reconciles */ }
    if (n.url) navigate(n.url)
  }

  async function clearNotifs() {
    // Purge every row for this user — the list empties for real, not just visually.
    setNotifs([])
    setNotifUnread(0)
    try { await api.clearNotifications() } catch { /* non-fatal */ }
    showToast('Notifications cleared')
  }

  async function doWipe() {
    setWiping(true)
    setWipeError('')
    try {
      await api.devWipe()
      setShowWipe(false)
      setWipeConfirm('')
      window.location.href = '/login' // fresh state after wipe
    } catch (err) {
      setWipeError(err instanceof Error ? err.message : 'Wipe failed')
    } finally {
      setWiping(false)
    }
  }

  return (
    <div className="h-full flex">
      {/* Mobile nav backdrop */}
      {navOpen && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* Sidebar — slide-in drawer on mobile, static column on desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] shrink-0 border-r border-slate-800/70 bg-[#0e1218] flex flex-col',
          'transition-transform duration-200 lg:static lg:w-60 lg:max-w-none lg:transition-none lg:translate-x-0 lg:transform-none',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="relative h-16 flex items-center gap-3 px-5 border-b border-slate-800/70">
          <button type="button" onClick={() => setShowAccount(true)} title="Account" className="rounded-lg hover:opacity-80">
            <img src="/logo.png" alt="Spiro" className="h-8 w-8 object-contain" />
          </button>
          <div>
            <div className="font-bold text-white leading-tight">Spiro</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">Admin Console</div>
          </div>
          {/* PC: beacon inside the brand block's top-right corner — equal
              padding from the top and right borders (12px each). */}
          {approvalCount !== null && approvalCount > 0 && (
            <span
              className="hidden lg:block absolute top-3 right-3"
              title="Awaiting approval — credit sale or discount needs a decision"
            >
              <Beacon />
            </span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV.filter((item) => (user ? canAccess(user.role, item.to) : false)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition',
                  isActive ? 'bg-brand-500/15 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
                )
              }
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
              {item.to === '/approvals' && approvalCount !== null && approvalCount > 0 && (
                <span className="absolute top-1/2 -translate-y-1/2 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-bold text-white rounded-full bg-amber-500 ring-1 ring-slate-800">
                  {approvalCount > 99 ? '99+' : approvalCount}
                </span>
              )}
              {/* Purchasing: active reorder lists + low/out-of-stock products */}
              {item.to === '/purchasing' && (
                <NavBadges
                  badges={[
                    { count: reorderCount, title: 'Active reorder lists needing fulfillment', className: 'bg-orange-500' },
                    { count: lowStockCount, title: 'Products under-stocked or out of stock', className: 'bg-red-500' },
                  ]}
                />
              )}
              {item.to === '/inventory' && (
                <NavBadges
                  badges={[
                    { count: lowStockCount, title: 'Products under-stocked or out of stock', className: 'bg-red-500' },
                  ]}
                />
              )}
              {item.to === '/approvals' && !(approvalCount !== null && approvalCount > 0) && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300">ctrl</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800/70 space-y-2">
          {/* Push subscribes itself on load (Workstream B) — no button to chase.
              This is a passive status line only. */}
          {push.state === 'subscribed' ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-brand-300">
              <span className="h-2 w-2 rounded-full bg-brand-400 animate-pulse" />
              Sale alerts on
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">
              {push.state === 'unsupported'
                ? '🔕 Alerts not supported on this browser'
                : push.state === 'denied'
                  ? '🔕 Alerts blocked in the browser'
                  : '🔔 Alerts start automatically'}
            </div>
          )}
          {/* DEV ONLY — remove before production */}
          <button
            onClick={() => setShowWipe(true)}
            className="hidden w-full text-xs px-3 py-2 rounded-lg border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition"
          >
            🧹 Dev: reset all data
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-slate-800/70 flex items-center justify-between px-4 sm:px-6 bg-[#0e1218]/60 backdrop-blur gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="btn-ghost lg:hidden !px-2.5 !py-2 relative"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {/* Mobile: beacon pinned to the hamburger's badge corner. */}
              {approvalCount !== null && approvalCount > 0 && (
                <span className="absolute -top-1 -right-1" title="Awaiting approval">
                  <Beacon />
                </span>
              )}
            </button>
            <div className="text-sm text-slate-400 truncate hidden sm:block">Phase 1 · Uganda Operations</div>
            <div className="font-semibold text-white sm:hidden">Spiro Admin</div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Durable inbox bell — same rows the POS shows for its own user */}
            <div className="relative">
              <button
                type="button"
                ref={bellRef}
                onClick={() => void openNotifs()}
                title={notifUnread > 0 ? `${notifUnread} unread notification${notifUnread === 1 ? '' : 's'}` : 'Notifications'}
                aria-label="Notifications"
                className="btn-ghost text-xs relative"
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
            </div>

            {/* Inbox popup — portaled to <body> so it always floats above page
                content (e.g. the Approvals list) regardless of local stacking
                contexts. Unread rows only; "Clear all" purges them from the DB. */}
            {showNotifs && notifPanel && createPortal(
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setShowNotifs(false)} />
                <div
                  className="fixed w-[300px] max-h-[70vh] overflow-y-auto card p-2 z-[100] shadow-2xl"
                  style={{ right: notifPanel.right, top: notifPanel.top }}
                >
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold text-white uppercase tracking-wider">Notifications</span>
                    {notifs.length > 0 && (
                      <button type="button" className="text-[11px] text-brand-300 hover:text-brand-200" onClick={() => void clearNotifs()}>
                        Clear all
                      </button>
                    )}
                  </div>
                  {notifLoading ? (
                    <p className="text-xs text-slate-500 px-2 py-3">Loading…</p>
                  ) : notifs.length === 0 ? (
                    <p className="text-xs text-slate-500 px-2 py-3">Nothing yet — sales, approvals, reservations and team changes land here.</p>
                  ) : (
                    <div className="space-y-1">
                      {notifs.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => void clickNotif(n)}
                          className="w-full text-left rounded-lg px-2.5 py-2 transition bg-brand-500/10 hover:bg-brand-500/20"
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
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
              </>,
              document.body,
            )}
            <div className="text-right">
              <div className="text-sm font-semibold text-white">{user?.full_name}</div>
              <div className="text-[11px] text-slate-500 capitalize">{user?.role}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      {/* Sale / push toasts (shared host — see Toaster.tsx) */}
      <ToastHost />

      {/* Account popup (logo click) */}
      {showAccount && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4" onClick={() => setShowAccount(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative card w-full max-w-xs p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <img src="/logo.png" alt="Spiro" className="h-12 w-12 object-contain mx-auto" />
            <div className="text-sm font-semibold text-white mt-2">{user?.full_name}</div>
            <div className="text-[11px] text-slate-500 capitalize">{user?.role}</div>
            <button
              className="btn-danger w-full mt-4"
              onClick={() => {
                setShowAccount(false)
                logout()
                navigate('/login')
              }}
            >
              Sign out
            </button>
            <button className="btn-ghost w-full mt-2" onClick={() => setShowAccount(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showWipe && (
        <Modal title="⚠️ Wipe all data?" onClose={() => setShowWipe(false)}>
          <p className="text-sm text-slate-400 mb-3">
            This permanently deletes <span className="text-white font-semibold">every sale, product, bike, customer,
            activation code, staff account (except you), approval and audit entry</span> from the database.
            There is no undo. You will stay signed in.
          </p>
          <p className="text-sm text-slate-400 mb-3">
            Type <code className="text-amber-300 font-mono font-bold">WIPE</code> to confirm:
          </p>
          <input
            className="input mb-3"
            value={wipeConfirm}
            onChange={(e) => setWipeConfirm(e.target.value)}
            placeholder="WIPE"
            autoFocus
          />
          {wipeError && <p className="text-sm text-red-400 mb-3">{wipeError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className="btn-ghost w-full sm:w-auto" onClick={() => setShowWipe(false)}>Cancel</button>
            <button
              className="btn-danger w-full sm:w-auto"
              disabled={wipeConfirm !== 'WIPE' || wiping}
              onClick={doWipe}
            >
              {wiping ? 'Wiping…' : 'Erase everything'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
