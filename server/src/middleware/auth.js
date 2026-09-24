const { getUserFromToken } = require('../auth');

/** Require a valid Bearer token; attaches req.user */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Session expired — sign in again' });
  // Distinct message so the POS can tell "you were deactivated" apart from an
  // expired token when it drops the operator back on the sign-in screen.
  if (!user.is_active) return res.status(401).json({ error: 'POS access deactivated — contact the administrator' });

  req.user = user;
  next();
}

/** Require one of the given roles (admin passes everything) */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { requireAuth, requireRole };
