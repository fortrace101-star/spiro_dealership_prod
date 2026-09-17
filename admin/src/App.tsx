import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { canAccess } from './lib/access'
import LoginScreen from './components/LoginScreen'
import Layout from './components/Layout'
import OverviewPage from './pages/OverviewPage'
import SalesPage from './pages/SalesPage'
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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
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
