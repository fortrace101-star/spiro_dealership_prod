export function ugx(v: string | number | null | undefined): string {
  const n = Number(v || 0)
  return `UGX ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`
}
