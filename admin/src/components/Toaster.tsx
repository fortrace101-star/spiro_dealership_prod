import { useEffect, useState } from 'react'

/**
 * App-wide toast host. Toasts are raised from anywhere via `showToast(...)`
 * (module-level emitter — no context plumbing), rendered bottom-right by
 * `<ToastHost />` mounted once in the Layout.
 *
 * This is deliberately separate from the notification (bell inbox) container:
 * push/sale alerts keep using toasts even after the inbox becomes unread-only.
 */
export interface Toast {
  id: number
  title: string
  body: string
}

type Listener = (t: Toast) => void
const listeners = new Set<Listener>()
let seq = 0

export function showToast(title: string, body = '') {
  const t: Toast = { id: ++seq, title, body }
  listeners.forEach((l) => l(t))
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onToast: Listener = (t) => {
      setToasts((prev) => [...prev.slice(-2), t])
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 8000)
    }
    listeners.add(onToast)
    return () => {
      listeners.delete(onToast)
    }
  }, [])

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[60] space-y-2 sm:w-80">
      {toasts.map((t) => (
        <div key={t.id} className="card p-4 border-brand-500/40 bg-[#12161d] shadow-xl animate-pulse">
          <div className="text-sm font-semibold text-white">{t.title}</div>
          {t.body && <div className="text-xs text-slate-400 mt-0.5">{t.body}</div>}
        </div>
      ))}
    </div>
  )
}
