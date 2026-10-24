import pool from '../db.js';

export const logAudit = async (actorId, action, entity, entityId, before = null, after = null) => {
  await pool.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, entity, entityId, before, after]
  );
};