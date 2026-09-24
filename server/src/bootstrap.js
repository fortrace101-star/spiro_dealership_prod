const { one } = require('./db');

/**
 * True while the install has no administrator yet — i.e. the database was
 * just wiped (or is brand new) and nobody has consumed a setup code.
 *
 * Drives two things: the login 409 in routes/auth.js, and the admin app's
 * redirect to the first-launch Setup screen.
 */
async function setupRequired() {
  const row = await one(
    `SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND is_active) AS admin_exists`
  );
  return !row?.admin_exists;
}

module.exports = { setupRequired };
