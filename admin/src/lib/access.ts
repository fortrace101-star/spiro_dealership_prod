import type { Role } from './types'

/**
 * Which roles may open each dashboard route.
 * Routes not listed here are open to every signed-in role.
 */
const ROUTE_ROLES: { path: string; roles: Role[] }[] = [
  { path: '/team', roles: ['admin'] },
  { path: '/audit', roles: ['admin'] },
  { path: '/approvals', roles: ['admin', 'manager'] },
  { path: '/sales', roles: ['admin', 'manager', 'cashier'] },
  { path: '/inventory', roles: ['admin', 'manager', 'mechanic'] },
  { path: '/purchasing', roles: ['admin', 'manager'] },
]

export function canAccess(role: Role, pathname: string): boolean {
  const rule = ROUTE_ROLES.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'))
  return !rule || rule.roles.includes(role)
}
