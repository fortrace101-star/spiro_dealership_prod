import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { canAccess } from './lib/access'
import { api } from './lib/api'
import LoginScreen from './components/LoginScreen'
import SetupScreen from './pages/SetupScreen'
import Layout from './components/Layout'
import OverviewPage from './pages/OverviewPage'
import SalesPage from './pages/SalesPage'
import CreditPage from './pages/CreditPage'
import InventoryPage from './pages/InventoryPage'
import ReordersPage from './pages/ReordersPage'
import BikesPage from './pages/BikesPage'
import CustomersPage from './pages/CustomersPage'
import TeamPage from './pages/TeamPage'
import ApprovalsPage from './pages/ApprovalsPage'
import AuditPage from './pages/AuditPage'
import SettingsPage from './pages/SettingsPage'

function Protected({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-pulse text-slate-500">Loading…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (!canAccess(user.role, location.pathname)) return <Navigate to="/" replace />
  return children
}

/**
 * On a fresh (or just-wiped) install there are no users, so signing in is
 * impossible — send the browser to /setup instead of a login form that could
 * only ever fail. Once an admin exists, /setup itself goes back to /login.
 * A failed status check (server down) must not trap the user, so it is
 * treated as "not required".
 */
function SetupGate() {
  const location = useLocation()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [required, setRequired] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .setupStatus()
      .then((s) => {
        if (!alive) return
        setRequired(s.setup_required)
        setChecked(true)
      })
      .catch(() => alive && setChecked(true))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!checked) return
    if (required && location.pathname !== '/setup') navigate('/setup', { replace: true })
    if (!required && location.pathname === '/setup') navigate('/login', { replace: true })
  }, [checked, required, location.pathname, navigate])

  return null
}

export default function App() {
  return (
    <AuthProvider>
      <SetupGate />
      <Routes>
        <Route path="/setup" element={<SetupScreen />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route
          path="/"
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="credit" element={<CreditPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="purchasing" element={<ReordersPage />} />
          <Route path="bikes" element={<BikesPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
