import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../lib/access'
import { usePush } from '../hooks/usePush'
import { api } from '../lib/api'
import { ugx } from '../lib/format'
import { Modal } from './Modal'
import { cn } from '../lib/cn'

interface Toast { id: number; title: string; body: string }

const NAV = [
  { to: '/', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10' },
  { to: '/sales', label: 'Sales', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 005.4 17H17M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z' },
  { to: '/inventory', label: 'Inventory', icon: 'M20 7l-8-4-8 4v10l8 4 8-4V7zM4 7l8 4m0 0l8-4m-8 4v10' },
  { to: '/purchasing', label: 'Purchasing', icon: 'M9 17V7m4 10V4m4 13v-6M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { to: '/bikes', label: 'Bikes / VIN', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/customers', label: 'Customers', icon: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { to: '/team', label: 'Team & Codes', icon: 'M12 4.35a4 4 0 100 6.3 4 4 0 000-6.3zM5 21v-2a6 6 0 0114 0v2' },
  { to: '/approvals', label: 'Approvals', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/audit', label: 'Audit Trail', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 104 0M9 5a2 2 0 014 0m-6 9l2 2 4-4' },
  { to: '/settings', label: 'Settings', icon: 'M10.325 4.317a1.724 1.724 0 012.573-1.066 1.724 1.724 0 012.242 0 1.724 1.724 0 011.066 2.573 1.724 1.724 0 001.066 2.242 1.724 1.724 0 010 2.242 1.724 1.724 0 01-2.573 1.066 1.724 1.724 0 01-2.242 0 1.724 1.724 0 01-1.066-2.573 1.724 1.724 0 00-1.066-2.242 1.724 1.724 0 010-2.242zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const push = usePush()
  const navigate = useNavigate()
  const [showWipe, setShowWipe] = useState(false)
  const [wipeConfirm, setWipeConfirm] = useState('')
  const [wiping, setWiping] = useState(false)
  const [wipeError, setWipeError] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [navOpen, setNavOpen] = useState(false)

  // In-app toast when a push arrives (e.g. a POS sale) while the dashboard is open
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const payload = e.data?.payload
      if (e.data?.type !== 'PUSH' || !payload) return
      const isSale = payload.receiptNo || payload.title?.includes('Sale')
      const t: Toast = { id: Date.now(), title: payload.title || 'Spiro', body: payload.body || '' }
      setToasts((prev) => [...prev.slice(-2), t])
      if (isSale) console.log(`[sale] ${payload.receiptNo || ''} ${ugx(Number(payload.total) || 0)} via ${payload.paymentMethod || '—'}`)
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 8000)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])

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
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800/70">
          <img src="/logo.png" alt="Spiro" className="h-8 w-8 object-contain" />
          <div>
            <div className="font-bold text-white leading-tight">Spiro</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">Admin Console</div>
          </div>
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
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition',
                  isActive ? 'bg-brand-500/15 text-brand-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50',
                )
              }
            >
              <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
              {item.to === '/approvals' && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300">ctrl</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800/70 space-y-2">
          {push.state === 'subscribed' ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-brand-300">
              <span className="h-2 w-2 rounded-full bg-brand-400 animate-pulse" />
              Sale alerts on
            </div>
          ) : (
            <button onClick={() => push.enable()} disabled={push.busy || push.state === 'unsupported'} className="btn-ghost w-full text-xs">
              🔔 Enable sale alerts
            </button>
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
              className="btn-ghost lg:hidden !px-2.5 !py-2"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="text-sm text-slate-400 truncate hidden sm:block">Phase 1 · Uganda Operations</div>
            <div className="font-semibold text-white sm:hidden">Spiro Admin</div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-right">
              <div className="text-sm font-semibold text-white">{user?.full_name}</div>
              <div className="text-[11px] text-slate-500 capitalize">{user?.role}</div>
            </div>
            <button
              onClick={() => {
                logout()
                navigate('/login')
              }}
              className="btn-ghost text-xs"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      {/* Sale / push toasts */}
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[60] space-y-2 sm:w-80">
        {toasts.map((t) => (
          <div key={t.id} className="card p-4 border-brand-500/40 bg-[#12161d] shadow-xl animate-pulse">
            <div className="text-sm font-semibold text-white">{t.title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{t.body}</div>
          </div>
        ))}
      </div>

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
