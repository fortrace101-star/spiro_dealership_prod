const { hasPermission, normalizeRole } = require('../permissions/catalog');

/**
 * Permission guard for POS capabilities.
 *
 * The role baseline lives in the catalog: managers hold every POS operation
 * and operators hold the selling + credit ones (requests + settlements, never
 * receiving / reservations / installments). The administrator can elevate a
 * trusted operator with an explicit grant (`inventory_receive`, `installment_
 * collect`, `reservation_*`, …). `req.user` is reloaded from the database on
 * every request, so a grant or revoke applies immediately — no re-login.
 *
 * `unlessRoles` stays available for the rare route that wants to bypass the
 * catalog entirely; it is empty by default because the role baseline already
 * covers it.
 */
function requirePermission(permission, opts = {}) {
  const { unlessRoles = [] } = opts;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (unlessRoles.map(normalizeRole).includes(normalizeRole(req.user.role))) return next();
    if (hasPermission(req.user, permission)) return next();

    return res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

module.exports = { requirePermission };

