import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'

/**
 * First-launch setup: shown on a brand new (or freshly wiped) install, where
 * the database has no users at all. The one-time code comes from the server's
 * `npm run setup:code`; only its SHA-256 hash is stored, so the plaintext is
 * printed exactly once on the machine that generated it.
 */
export default function SetupScreen() {
  const { user, completeSetup } = useAuth()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'checking' | 'required' | 'done'>('checking')
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .setupStatus()
      .then((s) => alive && setStatus(s.setup_required ? 'required' : 'done'))
      // Can't reach the server — still show the form rather than dead-end.
      .catch(() => alive && setStatus('required'))
    return () => {
      alive = false
    }
  }, [])

  // Hooks above must always run, so these come after them.
  if (user) return <Navigate to="/" replace />
  if (status === 'done') return <Navigate to="/login" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      await completeSetup({ code, full_name: fullName, email, password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Spiro" className="h-16 w-16 object-contain mb-4" />
          <h1 className="text-xl font-bold text-white">Welcome to Spiro</h1>
          <p className="text-sm text-slate-500 mt-1 text-center">
            Create the administrator account to finish setting up this install
          </p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          {status === 'checking' ? (
            <p className="text-sm text-slate-500 text-center animate-pulse">Checking setup status…</p>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Setup code</label>
                <input
                  className="input font-mono uppercase"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="SPIRO-SETUP-XXXX-XXXX"
                  required
                  autoFocus
                />
                <p className="text-[11px] text-slate-600 mt-1.5">
                  One-time code printed by <span className="font-mono text-slate-500">npm run setup:code</span> on the server
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Full name</label>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Confirm password</label>
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button className="btn-primary w-full" disabled={busy}>
                {busy ? 'Creating administrator…' : 'Create administrator'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
