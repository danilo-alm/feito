SELECT json_object(
    'selection', json_object(
        'generation', generation, 'epoch', epoch, 'spaceId', space_id, 'currentServerId', current_server_id,
        'discoverSession', json(iif(discover_session, 'true', 'false')), 'revokeSession', revoke_session
    ),
    'local', json((
        SELECT json_object('id', local_space.id, 'workspace', json(workspace_layers.workspace),
            'imports', json((
                SELECT json_group_object(id, json_object('binding', binding, 'result', json(result)))
                FROM import_receipts WHERE space_id = local_space.id
            ))
        ) FROM spaces AS local_space JOIN workspace_layers ON workspace_layers.space_id = local_space.id
        WHERE local_space.kind = 'local' AND workspace_layers.layer = 'working' AND (?1 OR local_space.id = selection.space_id)
    )),
    'remotes', json((
        SELECT json_group_array(json(replica))
        FROM (SELECT replica FROM workspace_replicas WHERE ?1 OR id = selection.space_id ORDER BY server_order, id)
    ))
)
FROM selection WHERE id = 1
