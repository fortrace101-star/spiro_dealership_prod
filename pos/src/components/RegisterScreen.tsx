import { useEffect, useState } from 'react'
import { api, ApiError, setSession, getDeviceId } from '../lib/api'

export default function RegisterScreen({ onAuthenticated, notice }: { onAuthenticated: () => void; notice?: string | null }) {
  // Arriving after a forced logout (revoked session): go straight to Sign in.
  const [mode, setMode] = useState<'register' | 'login'>(notice ? 'login' : 'register')
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 'checking' until we hear back: a fresh/wiped install has no users at all,
  // so the activate + sign-in form could only ever fail there.
  const [setupState, setSetupState] = useState<'checking' | 'ready' | 'required'>('checking')

  const checkSetup = async () => {
    try {
      const s = await api.setupStatus()
      setSetupState(s.setup_required ? 'required' : 'ready')
    } catch {
      // Server unreachable: we cannot know either way, and the POS is
      // offline-first. Show the form — the attempt itself will report its own
      // network error if the server really is down.
      setSetupState('ready')
    }
  }

  useEffect(() => {
    void checkSetup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res =
        mode === 'register'
          ? await api.register({ code: code.trim(), full_name: fullName.trim(), email: email.trim(), password, device_id: getDeviceId() })
          : await api.login(email.trim(), password)
      setSession(res.token, res.user)
      onAuthenticated()
    } catch (err) {
      // The server answers 409 while no administrator exists yet (fresh or
      // just-wiped install) — flip straight into the setup panel.
      if (err instanceof ApiError && err.status === 409) setSetupState('required')
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  // Before we know, and while the install still needs first-time setup, this
  // form would only ever fail — explain what is going on instead of letting
  // the operator guess why every activation code is "invalid".
  if (setupState !== 'ready') {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <img src="/logo.png" alt="Spiro" className="h-16 w-16 object-contain mb-4" />
            <h1 className="text-xl font-bold text-white">Spiro POS</h1>
            <p className="text-sm text-slate-500 mt-1">Offline-first point of sale</p>
          </div>

          {setupState === 'checking' ? (
            <div className="card p-6">
              <p className="text-sm text-slate-500 text-center animate-pulse">Checking installation…</p>
            </div>
          ) : (
            <div className="card p-6 space-y-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                This installation has not been set up yet — the server has no accounts at all.
              </div>
              <ol className="text-sm text-slate-400 space-y-2 list-decimal list-inside">
                <li>
                  Open the Spiro <span className="text-slate-300">Admin</span> app in a browser.
                </li>
                <li>
                  Finish first-time setup with the one-time code printed on the server by{' '}
                  <span className="font-mono text-slate-500">npm run setup:code</span>.
                </li>
                <li>Ask the administrator for an activation code for this terminal.</li>
                <li>Return here and tap Re-check.</li>
              </ol>
              <button className="btn-ghost w-full text-xs" onClick={() => { setSetupState('checking'); void checkSetup() }}>
                Re-check
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Spiro" className="h-16 w-16 object-contain mb-4" />
          <h1 className="text-xl font-bold text-white">Spiro POS</h1>
          <p className="text-sm text-slate-500 mt-1">Offline-first point of sale</p>
        </div>

        <div className="flex gap-2 mb-4">
          <button className={mode === 'register' ? 'btn-primary flex-1 text-xs' : 'btn-ghost flex-1 text-xs'} onClick={() => setMode('register')}>
            Activate with code
          </button>
          <button className={mode === 'login' ? 'btn-primary flex-1 text-xs' : 'btn-ghost flex-1 text-xs'} onClick={() => setMode('login')}>
            Sign in
          </button>
        </div>

        {notice && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {notice}
          </div>
        )}

        <form onSubmit={submit} className="card p-6 space-y-4">
          {mode === 'register' ? (
            <>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Activation code from admin</label>
                <input className="input font-mono uppercase tracking-wider" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SPIRO-XXXXXX" required autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Your full name</label>
                <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Grace Amina" required />
              </div>
              <div>
                <label htmlFor="activation-email" className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label>
                <input id="activation-email" name="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="grace@example.com" required />
                <p className="text-xs text-slate-500 mt-1">Use this email to sign in after activation.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Choose a password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" required minLength={6} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="grace@spiro.demo" required />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'register' ? 'Activate terminal' : 'Sign in'}
          </button>

          <p className="text-[11px] text-slate-600 text-center">
            Requires internet the first time. After that the POS works offline.
          </p>
        </form>
      </div>
    </div>
  )
}
