/**
 * Permission guard for POS capabilities granted via activation codes.
 * Reads req.user.permissions (array of strings, merged from the user's
 * activation code at registration). Admins always pass; roles listed in
 * unlessRoles inherently hold every permission (managers, by default).
 */
function requirePermission(permission, opts = {}) {
  const { unlessRoles = ['manager'] } = opts;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'admin' || unlessRoles.includes(req.user.role)) return next();

    const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (perms.includes(permission)) return next();

    return res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

module.exports = { requirePermission };
