import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../lib/access'
import { usePush } from '../hooks/usePush'
import { cn } from '../lib/cn'

const NAV = [
  { to: '/', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10' },
  { to: '/sales', label: 'Sales', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3A1 1 0 005.4 17H17M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z' },
  { to: '/inventory', label: 'Inventory', icon: 'M20 7l-8-4-8 4v10l8 4 8-4V7zM4 7l8 4m0 0l8-4m-8 4v10' },
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

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-slate-800/70 bg-[#0e1218] flex flex-col">
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

        <div className="p-3 border-t border-slate-800/70">
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
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 border-b border-slate-800/70 flex items-center justify-between px-6 bg-[#0e1218]/60 backdrop-blur">
          <div className="text-sm text-slate-400">Phase 1 · Uganda Operations</div>
          <div className="flex items-center gap-4">
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

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
