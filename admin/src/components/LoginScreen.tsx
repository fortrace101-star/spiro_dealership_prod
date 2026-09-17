import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginScreen() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  // Already signed in? Skip the form. (signedIn is excluded so the success
  // message stays visible during the short delay before navigate() runs.)
  if (user && !busy) return <Navigate to={from} replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      setSignedIn(true)
      // Brief pause so the success message is visible before the redirect.
      setTimeout(() => navigate(from, { replace: true }), 600)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Spiro" className="h-16 w-16 object-contain mb-4" />
          <h1 className="text-xl font-bold text-white">Spiro Admin</h1>
          <p className="text-sm text-slate-500 mt-1">E-bike & spare parts dealership ERP</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@spiro.demo"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {signedIn ? 'Signed in ✓' : busy ? 'Signing in…' : 'Sign in'}
          </button>

          {signedIn && (
            <p className="text-sm text-brand-300 bg-brand-500/10 border border-brand-500/20 rounded-lg px-3 py-2 text-center">
              ✓ Signed in — taking you to your dashboard…
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
