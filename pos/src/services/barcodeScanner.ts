/**
 * USB barcode scanners act as HID keyboards: they "type" the barcode very fast
 * and finish with Enter. We buffer keystrokes and dispatch when Enter arrives
 * or when the inter-keystroke gap exceeds the timeout.
 */
let buffer = ''
let timeout: ReturnType<typeof setTimeout> | null = null
let active = false
let lastKeyTime = 0
let onBarcodeCb: ((code: string) => void) | null = null

const MIN_LENGTH = 4
const TYPING_TIMEOUT_MS = 100
// Generous gap so a human typing the digits on a keyboard can pass the
// "scanner speed" test too — a real gun fires at ≤50 ms/char, so production
// scans are completely unaffected. Human typing anywhere else is still safe:
// keys are dropped while focus is in an input, and a slow buffer is discarded.
const MAX_GAP_MS = 400

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function startBarcodeScanner(onBarcode: (code: string) => void): () => void {
  onBarcodeCb = onBarcode
  if (active) return () => {}
  active = true

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (buffer.length >= MIN_LENGTH) {
        const code = buffer
        clearBuffer()
        onBarcode(code)
      }
      return
    }

    if (e.key.length === 1) {
      // Only treat as scanner input when focus is NOT in a text field,
      // so we never steal real typing.
      if (isTypingTarget(document.activeElement)) {
        clearBuffer()
        return
      }
      const now = Date.now()
      if (now - lastKeyTime > MAX_GAP_MS && buffer.length > 0) {
        // gap too long → previous buffer was probably human typing; drop it
        clearBuffer()
      }
      lastKeyTime = now
      buffer += e.key
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(clearBuffer, TYPING_TIMEOUT_MS)
    }
  }

  function clearBuffer() {
    buffer = ''
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => {
    window.removeEventListener('keydown', handleKeyDown)
    active = false
    onBarcodeCb = null
  }
}

/**
 * Simulate a scan programmatically — runs the exact same callback a real
 * scanner (or a keyboard-typed scan) triggers. Used by the on-screen
 * "test scan" box so the full flow can be exercised without a physical gun,
 * and handy for demos/support later.
 */
export function dispatchBarcode(code: string): void {
  const trimmed = code.trim()
  if (!trimmed || !onBarcodeCb) return
  onBarcodeCb(trimmed)
}
