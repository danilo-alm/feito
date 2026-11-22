SELECT id, method, path, authored_at, body, generated_ids
FROM pending_operations WHERE space_id = ?1 AND id = ?2
