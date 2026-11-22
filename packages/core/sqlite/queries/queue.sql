SELECT id, sequence, method, path, authored_at, body, generated_ids
FROM pending_operations WHERE space_id = ?1
ORDER BY sequence
