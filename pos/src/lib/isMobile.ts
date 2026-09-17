/**
 * Detects tablet devices (iPads, Android tablets, Kindle/Silk, etc.).
 * Runs on top of the mobile checks in `isMobileDevice()` so that
 * tablets are blocked even in landscape or in "Request desktop site" mode.
 */
export function isTabletDevice(): boolean {
  // Not running in a browser (SSR / tests) — treat as desktop.
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''

  // 1. User-Agent Client Hints (Chromium): a non-mobile Android device is a tablet.
  const uaData = (navigator as Navigator & {
    userAgentData?: { mobile?: boolean; platform?: string }
  }).userAgentData
  if (uaData && typeof uaData.mobile === 'boolean') {
    if (!uaData.mobile && /Android/i.test(uaData.platform || '')) return true
  }

  // 2. Classic user-agent sniffing for tablet-only identifiers.
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return true

  // 3. iPads on iOS 13+ report themselves as "Macintosh" — detect via touch.
  const isIpadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
  if (isIpadOS) return true

  // 4. Android tablets ship an Android UA without the "Mobile" token
  //    (phones include "Mobile"); catches tablet UAs missing the word "Tablet".
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true

  // 5. Fallback: coarse pointer (touch-first device) + tablet-width viewport.
  //    Catches tablets in "Request desktop site" mode.
  if (typeof window.matchMedia === 'function') {
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const tabletViewport = window.matchMedia('(max-width: 1024px)').matches
    if (coarsePointer && tabletViewport) return true
  }

  return false
}

/**
 * True when running on a phone OR tablet — i.e. any device the POS
 * does not support. Use this as the app-level gate.
 */
export function isMobileOrTablet(): boolean {
  return isMobileDevice() || isTabletDevice()
}

/**
 * Detects mobile devices (phones and tablets).
 * Combines several heuristics so devices are caught even when they
 * spoof their user agent ("Request desktop site" mode, etc.).
 */
export function isMobileDevice(): boolean {
  // Not running in a browser (SSR / tests) — treat as desktop.
  if (typeof navigator === 'undefined') return false

  // 1. User-Agent Client Hints (Chromium browsers — most reliable signal).
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (uaData && typeof uaData.mobile === 'boolean') {
    if (uaData.mobile) return true
  }

  const ua = navigator.userAgent || ''

  // 2. Classic user-agent sniffing.
  const mobileRe =
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|PlayBook|Silk|Kindle/i
  if (mobileRe.test(ua)) return true

  // 3. iPads on iOS 13+ report themselves as "Macintosh" — detect via touch.
  const isIpadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
  if (isIpadOS) return true

  // 4. Fallback: coarse pointer (touch-first device) + narrow viewport.
  //    Catches mobile browsers in "Request desktop site" mode.
  if (typeof window.matchMedia === 'function') {
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const narrowViewport = window.matchMedia('(max-width: 768px)').matches
    if (coarsePointer && narrowViewport) return true
  }

  return false
}
