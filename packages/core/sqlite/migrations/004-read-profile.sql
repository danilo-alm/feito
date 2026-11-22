CREATE VIEW workspace_layers AS
SELECT p.space_id, p.layer, json_object(
    'preferences', json_patch(json_object('timezone', p.timezone, 'theme', p.theme), json_object('locale', p.locale)),
    'projects', json((
        SELECT json_group_array(json_object(
            'id', id, 'revision', revision, 'isInbox', json(iif(is_inbox, 'true', 'false')),
            'data', json_object(
                'name', name, 'defaultSectionName', default_section_name, 'description', description,
                'color', color, 'icon', icon, 'archived', json(iif(archived, 'true', 'false')),
                'view', json(view), 'createdAt', created_at
            )
        )) FROM projects WHERE space_id = p.space_id AND layer = p.layer
    )),
    'sections', json((
        SELECT json_group_array(json_object(
            'id', id, 'revision', revision, 'projectId', project_id,
            'data', json_object('name', name, 'description', description, 'position', position)
        )) FROM sections WHERE space_id = p.space_id AND layer = p.layer
    )),
    'tasks', json((
        SELECT json_group_array(json_object(
            'id', id, 'revision', revision, 'projectId', project_id, 'sectionId', section_id,
            'parentId', parent_id, 'occurrenceId', occurrence_id,
            'data', json_object(
                'title', title, 'description', description, 'priority', priority, 'position', position,
                'createdAt', created_at, 'completedAt', completed_at, 'dueDate', due_date,
                'dueTime', due_time, 'recurrenceRule', json(recurrence_rule)
            )
        )) FROM tasks WHERE space_id = p.space_id AND layer = p.layer
    )),
    'labels', json((
        SELECT json_group_array(json_object('id', id, 'revision', revision, 'data', json_object('name', name)))
        FROM labels WHERE space_id = p.space_id AND layer = p.layer
    )),
    'taskLabels', json((
        SELECT json_group_array(json_array(task_id, json(label_ids))) FROM (
            SELECT task_id, json_group_array(label_id) AS label_ids FROM (
                SELECT task_id, label_id FROM task_labels WHERE space_id = p.space_id AND layer = p.layer
                ORDER BY task_id, position, label_id
            ) GROUP BY task_id
        )
    )),
    'occurrences', json((
        SELECT json_group_array(json_object('taskId', task_id, 'occurrenceId', occurrence_id,
            'data', json_patch(
                json_object('nominalDate', nominal_date, 'dueDate', due_date, 'dueTime', due_time, 'completedAt', completed_at),
                json_object('nextOccurrenceId', next_occurrence_id)
            )
        )) FROM completed_occurrences WHERE space_id = p.space_id AND layer = p.layer
    ))
) AS workspace
FROM preferences AS p;

CREATE VIEW workspace_replicas AS
SELECT s.id, s.server_order, json_object(
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
) AS replica
FROM spaces AS s LEFT JOIN replica_state AS state ON state.space_id = s.id
LEFT JOIN workspace_layers AS confirmed ON confirmed.space_id = s.id AND confirmed.layer = 'confirmed'
LEFT JOIN workspace_layers AS working ON working.space_id = s.id AND working.layer = 'working'
WHERE s.kind = 'remote';
