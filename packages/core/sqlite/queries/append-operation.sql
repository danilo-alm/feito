INSERT INTO pending_operations (space_id, sequence, id, method, path, authored_at, body, generated_ids)
SELECT space_id, next_sequence, ?2, ?3, ?4, ?5, ?6, ?7
FROM replica_state
WHERE space_id = ?1
