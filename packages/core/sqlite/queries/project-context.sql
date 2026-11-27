WITH root AS (
    SELECT * FROM projects WHERE space_id = ?1 AND layer = ?2 AND id = ?3
),
related AS (
    SELECT task.* FROM root
    JOIN tasks AS task ON task.space_id = root.space_id AND task.layer = root.layer AND task.project_id = root.id
),
links AS (
    SELECT task_labels.task_id, task_labels.label_id, task_labels.position
    FROM related JOIN task_labels ON task_labels.space_id = related.space_id
        AND task_labels.layer = related.layer AND task_labels.task_id = related.id
    ORDER BY task_labels.task_id, task_labels.position, task_labels.label_id
)
SELECT json_object(
    'preferences', json_patch(
        json_object('theme', preferences.theme, 'timezone', preferences.timezone),
        json_object('locale', preferences.locale, 'todayLayout', preferences.today_layout, 'upcomingLayout', preferences.upcoming_layout)
    ),
    'projects', json_array(json_object(
        'id', project.id, 'revision', project.revision, 'isInbox', json(IIF(project.is_inbox, 'true', 'false')),
        'data', json_patch(json_object(
            'name', project.name, 'defaultSectionName', project.default_section_name,
            'description', project.description, 'color', project.color, 'icon', project.icon,
            'archived', json(IIF(project.archived, 'true', 'false')), 'view', json(project.view), 'createdAt', project.created_at
        ), json_object('position', project.position, 'parentId', project.parent_id))
    )),
    'sections', json((
        SELECT json_group_array(json_object(
            'id', section.id, 'revision', section.revision, 'projectId', section.project_id, 'data', json_object(
                'name', section.name, 'description', section.description, 'position', section.position
            )
        ))
        FROM sections AS section
        WHERE section.space_id = ?1 AND section.layer = ?2
            AND section.project_id = project.id
    )),
    'tasks', json((
        SELECT json_group_array(json_object(
            'id', task.id, 'revision', task.revision, 'projectId', task.project_id,
            'parentId', task.parent_id, 'sectionId', task.section_id, 'occurrenceId', task.occurrence_id,
            'data', json_object(
                'title', task.title, 'description', task.description, 'priority', task.priority,
                'position', task.position, 'createdAt', task.created_at, 'completedAt', task.completed_at,
                'dueDate', task.due_date, 'dueTime', task.due_time, 'recurrenceRule', json(task.recurrence_rule)
            )
        )) FROM related AS task
    )),
    'labels', json((
        SELECT json_group_array(json_object(
            'id', label.id, 'revision', label.revision, 'data', json_patch(json_object('name', label.name), json_object('position', label.position))
        ))
        FROM labels AS label
        WHERE label.space_id = ?1 AND label.layer = ?2 AND label.id IN (SELECT label_id FROM links)
    )),
    'taskLabels', json((
        SELECT json_group_array(json_array(task_id, json(label_ids)))
        FROM (SELECT task_id, json_group_array(label_id) AS label_ids FROM links GROUP BY task_id)
    )),
    'occurrences', json_array()
)
FROM root AS project
JOIN preferences ON preferences.space_id = project.space_id AND preferences.layer = project.layer
