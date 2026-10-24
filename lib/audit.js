/** Append-only audit trail. Called inside the same transaction as the change. */
export async function audit(client, userId, action, entity, entityId, before, after, reason) {
  await client.query(
    `INSERT INTO audit_log(user_id, action, entity, entity_id, before, after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId || null, action, entity, entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason || null]
  );
}
