const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { one } = require('./db');
const { jwtSecret } = require('./config');

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name, permissions: user.permissions || [] },
    jwtSecret,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

async function getUserFromToken(token) {
  const payload = verifyToken(token);
  if (!payload) return null;
  return one(`SELECT id, full_name, email, phone, role, permissions, is_active FROM users WHERE id = $1`, [payload.sub]);
}

module.exports = { signToken, verifyToken, hashPassword, verifyPassword, getUserFromToken };
