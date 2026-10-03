  import { useCallback, useEffect, useState } from 'react'
import { api, getToken } from '../lib/api'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** Short two-tone chime (~0.4s) for push toasts. Exported so Layout can play
 *  it when a push arrives; Web Audio needs no audio file and respects the
 *  OS / browser mute state — it cannot force sound through a muted device. */
export function playPushChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq: number, at: number, dur = 0.18) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur + 0.05)
    }
    const t = ctx.currentTime + 0.02
    play(880, t)          // A5
    play(1174.66, t + 0.2) // D6
    setTimeout(() => void ctx.close().catch(() => {}), 800)
  } catch {
    /* audio unsupported or blocked — toast still shows */
  }
}

export type PushState = 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'unsubscribed'

// ---------- Auto-subscribe plumbing (no visible button — see Workstream B) ----------

/** WebKit (Safari/iOS) refuses Notification.requestPermission() outside a user
 *  gesture, so the first tap/key anywhere arms a one-shot retry. Chromium and
 *  Firefox allow the prompt to be raised immediately. */
const IS_WEBKIT =
  typeof navigator !== 'undefined' &&
  'safari' in window &&
  !/Chrome|Chromium|Edg\/|OPR\//.test(navigator.userAgent)

/** iOS/iPadOS only — where push requires the site to be installed to the home
 *  screen (Share → Add to Home Screen). */
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** Module-level so the hint is genuinely one-time per page session, no matter
 *  how many components mount the hook. */
let noticeShown = false
let gestureArmed = false

/** Arm a one-shot gesture listener that retries the subscription on the first
 *  interaction — the only way WebKit will grant notification permission. */
function armGestureRetry(retry: () => void): void {
  if (gestureArmed || typeof document === 'undefined') return
  gestureArmed = true
  const fire = () => {
    document.removeEventListener('pointerdown', fire)
    document.removeEventListener('keydown', fire)
    retry()
  }
  document.addEventListener('pointerdown', fire, { passive: true })
  document.addEventListener('keydown', fire)
}


/**
 * Admin dashboard Web Push subscription.
 * On supported browsers + secure origin, registers /sw.js (vite-plugin-pwa),
 * subscribes the user via VAPID, and persists the endpoint to the server.
 * State is 'unsupported' when PushManager isn't available — a descriptive
 * error message explains whether the cause is insecure origin or browser.
 */
export function usePush() {
  const [state, setState] = useState<PushState>('unsubscribed')
  const [busy, setBusy] = useState(false)
  // Human-readable failure reason shown under the Enable alerts button so a
  // blocked/failed subscription is never a silent no-op.
  const [error, setError] = useState('')

  const detect = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      const isSecure = location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.hostname === '::1'
      if (!isSecure) {
        setError('Push notifications require HTTPS. This site is served over HTTP — use https:// or access via localhost.')
      } else {
        setError('This browser does not support push notifications. Try Chrome, Edge, or Firefox.')
      }
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    setState(sub ? 'subscribed' : Notification.permission === 'granted' ? 'unsubscribed' : 'prompt')
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if ('Notification' in window && Notification.permission === 'denied') {
        setError('Notifications are blocked for this site. Click the lock icon in the address bar, set Notifications to Allow, then click Enable alerts again.')
        return false
      }
      if ('Notification' in window && Notification.permission === 'default') {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          setError('Notification permission was not granted — no alerts can be delivered.')
          return false
        }
      }
      const { publicKey } = await api.vapidPublicKey()
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        }))

      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await api.subscribe(json)
      setState('subscribed')
      return true
    } catch (err) {
      console.error('[push] subscribe failed', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        msg.includes('NotAllowed')
          ? 'Notifications are blocked for this site. Allow them via the lock icon in the address bar, then try again.'
          : `Could not enable alerts: ${msg}`,
      )
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const sendTest = useCallback(async () => {
    try {
      await api.testPush()
      return true
    } catch {
      return false
    }
  }, [])

  // One-time informational message (iOS install hint / blocked alerts). Layout
  // turns it into a toast, then calls dismissNotice().
  const [notice, setNotice] = useState('')
  const dismissNotice = useCallback(() => setNotice(''), [])

  const showNoticeOnce = useCallback((msg: string) => {
    if (noticeShown) return
    noticeShown = true
    setNotice(msg)
  }, [])

  /** Fully automatic: detect, then subscribe or (silently) prompt. No button. */
  const ensurePush = useCallback(async (): Promise<boolean> => {
    // 1. Unsupported browser or insecure origin → silent stop (state explains why).
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      await detect().catch(() => setState('unsupported'))
      // iOS must be installed to the home screen before it can receive push.
      if (IS_IOS && !isStandalone()) {
        showNoticeOnce('For alerts on iPhone/iPad, open Share → “Add to Home Screen”.')
      }
      return false
    }
    // 5. Denied → silent; a single nudge on mobile where the setting is buried.
    if (Notification.permission === 'denied') {
      setState('denied')
      if (IS_IOS || /Android/i.test(navigator.userAgent)) {
        showNoticeOnce('Alerts are blocked in the browser — allow notifications for this site in Settings.')
      }
      return false
    }
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
    const existing = reg ? await reg.pushManager.getSubscription().catch(() => null) : null
    // 2. Already subscribed → done.
    if (existing) {
      setState('subscribed')
      return true
    }
    // 3. Permission already granted → subscribe silently.
    if (Notification.permission === 'granted') return enable()
    // 4. Default permission: prompt now on Chromium/Firefox; on WebKit wait for
    //    the first gesture (Safari silently ignores a programmatic prompt).
    if (!IS_WEBKIT) return enable()
    setState('prompt')
    armGestureRetry(() => { void enable() })
    return false
  }, [detect, enable, showNoticeOnce])

  // Auto-subscribe on login, and re-assert whenever the tab is refocused, the
  // device comes back online, or a freshly deployed service worker takes over.
  useEffect(() => {
    if (!getToken()) return
    void ensurePush()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ensurePush()
    }
    const onOnline = () => { void ensurePush() }
    const onController = () => { void ensurePush() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    navigator.serviceWorker?.addEventListener('controllerchange', onController)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      navigator.serviceWorker?.removeEventListener('controllerchange', onController)
    }
  }, [ensurePush])

  return { state, busy, error, enable, sendTest, refresh: detect, ensurePush, notice, dismissNotice }
}

export default usePush

