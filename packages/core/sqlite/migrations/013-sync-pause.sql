ALTER TABLE replica_state ADD COLUMN sync_paused INTEGER NOT NULL DEFAULT 0 CHECK (sync_paused IN (0, 1));

DROP VIEW workspace_replicas;
CREATE VIEW workspace_replicas AS
SELECT s.id, s.server_order, json_patch(json_object(
    'id', s.id, 'origin', s.origin, 'user', json_object('id', s.account_id, 'email', s.account_email),
    'cursor', state.cursor, 'notice', state.notice,
    'confirmed', json(confirmed.workspace), 'working', json(working.workspace),
    'pending', json((
        SELECT json_group_array(json(operation)) FROM (
            SELECT json_remove(
                json_object('id', id, 'method', method, 'path', path, 'authoredAt', authored_at,
                            'body', json(body), 'generatedIds', json(generated_ids)),
                iif(body IS NULL, '$.body', '$.unused'),
                iif(generated_ids IS NULL, '$.generatedIds', '$.unused')
            ) AS operation FROM pending_operations WHERE space_id = s.id ORDER BY sequence
        )
    ))
), json_object('syncPaused', json(CASE WHEN state.sync_paused THEN 'true' END))) AS replica
FROM spaces AS s LEFT JOIN replica_state AS state ON state.space_id = s.id
LEFT JOIN workspace_layers AS confirmed ON confirmed.space_id = s.id AND confirmed.layer = 'confirmed'
LEFT JOIN workspace_layers AS working ON working.space_id = s.id AND working.layer = 'working'
WHERE s.kind = 'remote';
