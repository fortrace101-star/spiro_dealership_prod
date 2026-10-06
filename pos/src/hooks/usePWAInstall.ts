import { useCallback, useEffect, useState } from 'react'

/** Chromium's install prompt. Captured at MODULE scope (not in an effect) so an
 *  event fired before POSScreen mounts — Chromium fires it shortly after load —
 *  is never lost. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null

/** iOS/iPadOS never fires beforeinstallprompt — installation there is
 *  Share → "Add to Home Screen" (the guide text below says so). */
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

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's mini-infobar — the POS header has its own Install button.
    e.preventDefault()
    deferred = e as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
  })
}

export type InstallOutcome = 'installed' | 'dismissed' | 'guide'

/**
 * PWA "download" support for the POS header.
 *  - `install()` raises Chrome's native install dialog when the browser offers
 *    the prompt (manifest + service worker are in place), otherwise returns
 *    'guide' so the caller can flash the manual steps for this platform.
 *  - `installed` flips true once the app runs standalone (button hides).
 *  - `guideText` explains the fallback path (iOS share sheet / secure-context
 *    requirement / browser menu) for browsers without the prompt.
 */
export function usePWAInstall(): {
  installed: boolean
  install: () => Promise<InstallOutcome>
  guideText: string
} {
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onInstalled = () => {
      deferred = null
      setInstalled(true)
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (!deferred) return 'guide'
    await deferred.prompt()
    const choice = await deferred.userChoice
    deferred = null
    return choice.outcome === 'accepted' ? 'installed' : 'dismissed'
  }, [])

  const guideText = IS_IOS
    ? 'To install: tap Share → “Add to Home Screen”'
    : typeof window !== 'undefined' && !window.isSecureContext
      ? 'Installing needs a secure address — open the POS via https:// (or localhost), then use the browser menu → Install app'
      : 'Use the browser menu (⋮) → “Install Spiro POS” / “Install this site as an app”'

  // `isStandalone()` re-checked each render so a display-mode change without
  // an appinstalled event still hides the button.
  return { installed: installed || isStandalone(), install, guideText }
}
