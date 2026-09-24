'use strict';

/**
 * Single source of truth for POS roles and per-operation permissions.
 *
 * Model (confirmed with the shop owner):
 *   - Roles: `admin` (back-office only), `manager` and `operator` (the two POS
 *     roles). `cashier` / `mechanic` are pre-rename values that are normalized
 *     to `operator` so un-migrated rows and old tokens keep working. The
 *     mechanic role is removed: the POS and Team page only ever offer
 *     manager / operator.
 *   - Receiving stock is manager-only. The admin may elevate a trusted
 *     operator with the `inventory_receive` grant; the baseline operator
 *     never receives. Receiving is all-or-nothing: the grant covers the whole
 *     flow — fulfilling a reorder list, starting a standalone restock and
 *     creating new products inline (there is no separate `product_create` id).
 *   - Credit requests are an every-role op (manager and operator): the sale
 *     always waits for admin approval anyway. Finalizing an approved credit
 *     sale and recording settlements are manager only — the admin can elevate
 *     a trusted operator with `credit_finalize` / `credit_settle`. Installment
 *     money-in on reservations is manager only (admin can elevate an operator
 *     via `reservation_pay`).
 *   - Discounts can only be approved AND issued by the administrator: there
 *     is no POS discount capability at all, so the Team page has nothing to
 *     tick, the operator checkout modal has no discount field, and any
 *     hand-crafted payload carrying one (header or line level) is refused
 *     server-side — exactly like a credit sale, every discount needs admin
 *     approval before money moves.
 *   - Reservations (create / complete) are manager only (admin can elevate an
 *     operator). Releasing a bike back to stock additionally requires an
 *     admin approval — the POS request only opens the ticket.
 *   - Every operation the POS can perform has an id in this catalog. A role
 *     supplies a baseline (see `roles` on each entry); the administrator can
 *     additionally tick any *grantable* permission for a specific user or
 *     activation code. Grants are stored as a JSONB array on users /
 *     activation_codes and merged with the role baseline on every request.
 *   - `adminOnly` entries can never be granted: they describe work the admin
 *     does in the dashboard (today: issuing discounts).
 *
 * Everything that guards a route (server) and everything that renders a
 * checkbox (admin Team page) reads from here, so enforcement and UI cannot
 * drift apart.
 */

/** Every role value the database may contain. */
const ROLES = ['admin', 'manager', 'operator'];
/** Roles that can sign into the POS. */
const POS_ROLES = ['manager', 'operator'];

/** Values written before the role rename — still found in older databases. */
const LEGACY_ROLE_ALIASES = { cashier: 'operator', mechanic: 'operator' };

/** Group order used by the admin Team page. */
const GROUPS = ['Sales', 'Credit', 'Reservations', 'Stock'];

/**
 * The POS operation catalog.
 *   id          — stable permission id (stored in the JSONB grants)
 *   group       — section in the admin UI
 *   label/hint  — admin-facing wording
 *   roles       — roles that hold this by default (the role baseline)
 *   adminOnly   — never grantable to a POS role
 *   approval    — approval type the server requires regardless of role
 */
const PERMISSIONS = [
  {
    id: 'pos_sell',
    group: 'Sales',
    label: 'Make sales & print receipts',
    hint: 'Cart, checkout (cash / MoMo / bank / card) and receipts — every POS role',
    roles: ['manager', 'operator'],
  },
  {
    id: 'credit_request',
    group: 'Sales',
    label: 'Send credit-sale requests',
    hint: 'Puts a debt sale in front of the admin for approval — every POS role',
    roles: ['manager', 'operator'],
  },
  {
    id: 'credit_finalize',
    group: 'Credit',
    label: 'Finalize approved credit sales',
    hint: 'The completion click: deducts stock and opens the debt after approval — manager only, admin can elevate an operator',
    roles: ['manager'],
  },
  {
    id: 'credit_settle',
    group: 'Credit',
    label: 'Record credit settlements',
    hint: 'Money-in against an outstanding credit debt — manager only, admin can elevate an operator',
    roles: ['manager'],
  },
  {
    id: 'installment_collect',
    group: 'Credit',
    label: 'Record reservation installments',
    hint: 'Money-in against an active bike reservation — manager only, admin can elevate an operator',
    roles: ['manager'],
  },
  {
    id: 'reservation_create',
    group: 'Reservations',
    label: 'Create reservations',
    hint: 'Take a down payment and lock the bike VIN — manager only',
    roles: ['manager'],
  },
  {
    id: 'reservation_complete',
    group: 'Reservations',
    label: 'Complete reservations',
    hint: 'Turn a fully paid reservation into a sale — manager only',
    roles: ['manager'],
  },
  {
    id: 'reservation_release',
    group: 'Reservations',
    label: 'Release reservations (request)',
    hint: 'Bike returns to stock — manager only, and releasing always needs an admin approval',
    roles: ['manager'],
    approval: 'reservation_release',
  },
  {
    id: 'inventory_receive',
    group: 'Stock',
    label: 'Receive stock',
    hint: 'Record consignments, create new products and move stock in — the whole receive flow; manager only, admin can elevate an operator',
    roles: ['manager'],
  },
  {
    id: 'reorder_create',
    group: 'Stock',
    label: 'Create reorder lists',
    hint: 'Draft what to order next — never changes stock (manager only)',
    roles: ['manager'],
  },
  {
    id: 'reorder_manage',
    group: 'Stock',
    label: 'Manage reorder lists',
    hint: 'Mark a list processed / fulfilled / cancelled — manager only',
    roles: ['manager'],
  },
  {
    id: 'discount_apply',
    group: 'Sales',
    label: 'Apply discounts',
    hint: 'Admin-issued only — the POS checkout has no discount field',
    roles: ['admin'],
    adminOnly: true,
  },
];

const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);
const PERMISSION_BY_ID = new Map(PERMISSIONS.map((p) => [p.id, p]));

/** Held by every POS role without an explicit grant (no checkbox needed). */
const BASELINE_PERMISSION_IDS = PERMISSIONS
  .filter((p) => !p.adminOnly && p.roles.includes('operator') && p.roles.includes('manager'))
  .map((p) => p.id);

/** Tickable on a user / activation code: role-specific or manager-by-default. */
const GRANTABLE_PERMISSION_IDS = PERMISSIONS
  .filter((p) => !p.adminOnly && !BASELINE_PERMISSION_IDS.includes(p.id))
  .map((p) => p.id);

/** Values stored before this catalog existed, expanded to their successors. */
const LEGACY_PERMISSION_ALIASES = {
  inventory_entry: ['inventory_receive', 'reorder_manage'],
};

/** `cashier` / `mechanic` → `operator`; unknown values pass through untouched. */
function normalizeRole(role) {
  if (typeof role !== 'string') return '';
  const value = role.trim().toLowerCase();
  return LEGACY_ROLE_ALIASES[value] || value;
}

function isKnownRole(role) {
  return ROLES.includes(normalizeRole(role));
}

/** A role that signs into the POS (managers and operators). */
function isPosRole(role) {
  return POS_ROLES.includes(normalizeRole(role));
}

/**
 * Normalize a stored grant list: alias-expand legacy ids, drop unknown ids,
 * drop admin-only ids (never grantable) and de-duplicate.
 */
function expandPermissions(list) {
  const out = new Set();
  if (!Array.isArray(list)) return [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    const expanded = LEGACY_PERMISSION_ALIASES[id] || [id];
    for (const candidate of expanded) {
      const def = PERMISSION_BY_ID.get(candidate);
      if (def && !def.adminOnly) out.add(candidate);
    }
  }
  return [...out];
}

/** The permissions a role holds without any grant. */
function defaultPermissions(role) {
  const normalized = normalizeRole(role);
  if (normalized === 'admin') return PERMISSION_IDS.filter((id) => !PERMISSION_BY_ID.get(id).adminOnly);
  return PERMISSIONS
    .filter((p) => !p.adminOnly && p.roles.includes(normalized))
    .map((p) => p.id);
}

/**
 * The enforced permission set for a user: admin → everything (minus admin-only
 * shortcuts), manager/operator → role baseline ∪ granted permissions.
 */
function effectivePermissions(user) {
  if (!user) return [];
  const role = normalizeRole(user.role);
  const ids = new Set(defaultPermissions(role));
  for (const id of expandPermissions(user.permissions)) ids.add(id);
  return [...ids].sort();
}

function hasPermission(user, permission) {
  if (!user || !permission) return false;
  return effectivePermissions(user).includes(permission);
}

/** Catalog payload for the admin Team page (`GET /api/admin/permissions`). */
function catalog() {
  return {
    roles: POS_ROLES,
    groups: GROUPS.map((name) => ({
      name,
      permissions: PERMISSIONS
        .filter((p) => p.group === name && !p.adminOnly)
        .map((p) => ({
          id: p.id,
          label: p.label,
          hint: p.hint,
          defaultRoles: p.roles.includes('operator') ? POS_ROLES : ['manager'],
          grantable: GRANTABLE_PERMISSION_IDS.includes(p.id),
          baseline: BASELINE_PERMISSION_IDS.includes(p.id),
        })),
    })).filter((g) => g.permissions.length > 0),
  };
}

module.exports = {
  ROLES,
  POS_ROLES,
  GROUPS,
  PERMISSIONS,
  PERMISSION_IDS,
  PERMISSION_BY_ID,
  BASELINE_PERMISSION_IDS,
  GRANTABLE_PERMISSION_IDS,
  LEGACY_PERMISSION_ALIASES,
  LEGACY_ROLE_ALIASES,
  normalizeRole,
  isKnownRole,
  isPosRole,
  expandPermissions,
  defaultPermissions,
  effectivePermissions,
  hasPermission,
  catalog,
};
