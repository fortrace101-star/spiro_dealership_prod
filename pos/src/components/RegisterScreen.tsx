import { useState } from 'react'
import { api, setSession, getDeviceId } from '../lib/api'

export default function RegisterScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [code, setCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res =
        mode === 'register'
          ? await api.register({ code: code.trim(), full_name: fullName.trim(), password, device_id: getDeviceId() })
          : await api.login(email.trim(), password)
      setSession(res.token, res.user)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
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
