const { one } = require('../db');

/** Append to the audit trail. Never throws into the request path. */
async function audit({ userId = null, action, entity, entityId = null, oldValue = null, newValue = null, meta = null }) {
  try {
    await one(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, action, entity, entityId ? String(entityId) : null,
       oldValue ? JSON.stringify(oldValue) : null,
       newValue ? JSON.stringify(newValue) : null,
       meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('[audit] failed:', err.message);
  }
}

module.exports = { audit };
