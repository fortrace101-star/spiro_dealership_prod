import { useEffect, useMemo, useState } from 'react'

// Live viewport width, SSR-safe; flips state on resize without a reload.
function useViewportWidth(): number {
  const [vw, setVw] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  )
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vw
}

// Page size for paginated admin tables: 10 rows on phones, 20 on PC/tablet.
// Keep the 640 px boundary identical to `col-opt`.
export function usePageSize(): number {
  const vw = useViewportWidth()
  return useMemo(() => (vw < 640 ? 10 : 20), [vw])
}

// True below the 640 px `sm:` breakpoint — the same boundary as usePageSize
// and col-opt, so compact picker labels always agree with the table standard.
export function useIsPhone(): boolean {
  const vw = useViewportWidth()
  return useMemo(() => vw < 640, [vw])
}
