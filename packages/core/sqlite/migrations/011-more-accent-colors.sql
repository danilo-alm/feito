-- More accent colors for the Feito themes. SQLite cannot change a column's CHECK constraint, so the value
-- moves to a new column with the wider list, which then takes the old column's name. The views and triggers
-- that read the column are dropped first and recreated unchanged afterwards.
ALTER TABLE preferences ADD COLUMN accent_next TEXT CHECK (accent_next IS NULL OR accent_next IN ('green', 'teal', 'mint', 'lime', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'lavender', 'purple', 'magenta', 'pink', 'red', 'coral', 'orange', 'terracotta', 'amber', 'yellow', 'graphite'));
UPDATE preferences SET accent_next = accent WHERE accent IS NOT NULL;

DROP TRIGGER import_workspace_layer_insert;
DROP TRIGGER save_workspace_layer_insert;
DROP VIEW workspace_replicas;
DROP VIEW workspace_layers;

ALTER TABLE preferences DROP COLUMN accent;
ALTER TABLE preferences RENAME COLUMN accent_next TO accent;

CREATE TRIGGER import_workspace_layer_insert
INSTEAD OF INSERT ON import_workspace_layer
BEGIN
    SELECT CASE WHEN
        json_type(NEW.document, '$.preferences') IS NOT 'object'
        OR json_type(NEW.document, '$.projects') IS NOT 'array'
        OR json_type(NEW.document, '$.sections') IS NOT 'array'
        OR json_type(NEW.document, '$.tasks') IS NOT 'array'
        OR json_type(NEW.document, '$.labels') IS NOT 'array'
        OR json_type(NEW.document, '$.taskLabels') IS NOT 'array'
        OR json_type(NEW.document, '$.occurrences') IS NOT 'array'
        OR (json_type(NEW.document, '$.comments') IS NOT NULL AND json_type(NEW.document, '$.comments') IS NOT 'array')
        THEN RAISE(ABORT, 'Invalid workspace document') END;

    INSERT INTO preferences (space_id, layer, timezone, theme, locale, today_layout, upcoming_layout, light_theme, dark_theme, accent, today_timeline)
    VALUES (NEW.space_id, NEW.layer,
        json_extract(NEW.document, '$.preferences.timezone'),
        json_extract(NEW.document, '$.preferences.theme'),
        json_extract(NEW.document, '$.preferences.locale'),
        json_extract(NEW.document, '$.preferences.todayLayout'),
        json_extract(NEW.document, '$.preferences.upcomingLayout'),
        json_extract(NEW.document, '$.preferences.lightTheme'),
        json_extract(NEW.document, '$.preferences.darkTheme'),
        json_extract(NEW.document, '$.preferences.accent'),
        json_extract(NEW.document, '$.preferences.todayTimeline'));

    INSERT INTO projects (space_id, layer, id, revision, is_inbox, name,
        default_section_name, description, color, icon, archived, view, created_at, position, parent_id)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision',
        value ->> '$.isInbox', value ->> '$.data.name', value ->> '$.data.defaultSectionName',
        coalesce(value ->> '$.data.description', ''), value ->> '$.data.color',
        coalesce(value ->> '$.data.icon', 'hash'), value ->> '$.data.archived',
        value -> '$.data.view', coalesce(value ->> '$.data.createdAt', '1970-01-01T00:00:00Z'),
        value ->> '$.data.position', value ->> '$.data.parentId'
    FROM json_each(NEW.document, '$.projects');

    INSERT INTO sections (space_id, layer, id, project_id, revision, name, description, position)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.projectId', value ->> '$.revision',
        value ->> '$.data.name', coalesce(value ->> '$.data.description', ''), value ->> '$.data.position'
    FROM json_each(NEW.document, '$.sections');

    INSERT INTO tasks (space_id, layer, id, project_id, section_id, parent_id, revision, occurrence_id,
        title, description, priority, position, created_at, completed_at, due_date, due_time, recurrence_rule)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.projectId',
        value ->> '$.sectionId', value ->> '$.parentId', value ->> '$.revision',
        value ->> '$.occurrenceId', value ->> '$.data.title', value ->> '$.data.description',
        value ->> '$.data.priority', value ->> '$.data.position', value ->> '$.data.createdAt',
        value ->> '$.data.completedAt', value ->> '$.data.dueDate', value ->> '$.data.dueTime',
        value ->> '$.data.recurrenceRule'
    FROM json_each(NEW.document, '$.tasks');

    INSERT INTO labels (space_id, layer, id, revision, name, position)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision', value ->> '$.data.name',
        value ->> '$.data.position'
    FROM json_each(NEW.document, '$.labels');

    INSERT INTO task_labels (space_id, layer, task_id, label_id, position)
    SELECT NEW.space_id, NEW.layer, link.value ->> '$[0]', label.value, label.key
    FROM json_each(NEW.document, '$.taskLabels') AS link
    CROSS JOIN json_each(link.value, '$[1]') AS label;

    INSERT INTO completed_occurrences (space_id, layer, task_id, occurrence_id, nominal_date,
        due_date, due_time, completed_at, next_occurrence_id)
    SELECT NEW.space_id, NEW.layer, value ->> '$.taskId', value ->> '$.occurrenceId',
        value ->> '$.data.nominalDate', value ->> '$.data.dueDate', value ->> '$.data.dueTime',
        value ->> '$.data.completedAt', value ->> '$.data.nextOccurrenceId'
    FROM json_each(NEW.document, '$.occurrences');

    INSERT INTO task_comments (space_id, layer, id, task_id, revision, body, created_at, edited_at)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.taskId', value ->> '$.revision',
        value ->> '$.data.body', value ->> '$.data.createdAt', value ->> '$.data.editedAt'
    FROM json_each(NEW.document, '$.comments');
END;

CREATE TRIGGER save_workspace_layer_insert
INSTEAD OF INSERT ON save_workspace_layer
BEGIN
    SELECT CASE WHEN
        json_type(NEW.document, '$.preferences') IS NOT 'object'
        OR json_type(NEW.document, '$.projects') IS NOT 'array'
        OR json_type(NEW.document, '$.sections') IS NOT 'array'
        OR json_type(NEW.document, '$.tasks') IS NOT 'array'
        OR json_type(NEW.document, '$.labels') IS NOT 'array'
        OR json_type(NEW.document, '$.taskLabels') IS NOT 'array'
        OR json_type(NEW.document, '$.occurrences') IS NOT 'array'
        OR (json_type(NEW.document, '$.comments') IS NOT NULL AND json_type(NEW.document, '$.comments') IS NOT 'array')
        THEN RAISE(ABORT, 'Invalid workspace document') END;

    INSERT INTO preferences (space_id, layer, timezone, theme, locale, today_layout, upcoming_layout, light_theme, dark_theme, accent, today_timeline)
    VALUES (NEW.space_id, NEW.layer,
        json_extract(NEW.document, '$.preferences.timezone'),
        json_extract(NEW.document, '$.preferences.theme'),
        json_extract(NEW.document, '$.preferences.locale'),
        json_extract(NEW.document, '$.preferences.todayLayout'),
        json_extract(NEW.document, '$.preferences.upcomingLayout'),
        json_extract(NEW.document, '$.preferences.lightTheme'),
        json_extract(NEW.document, '$.preferences.darkTheme'),
        json_extract(NEW.document, '$.preferences.accent'),
        json_extract(NEW.document, '$.preferences.todayTimeline'))
    ON CONFLICT (space_id, layer) DO UPDATE SET
        timezone = excluded.timezone,
        theme = excluded.theme,
        locale = excluded.locale,
        today_layout = excluded.today_layout,
        upcoming_layout = excluded.upcoming_layout,
        light_theme = excluded.light_theme,
        dark_theme = excluded.dark_theme,
        accent = excluded.accent,
        today_timeline = excluded.today_timeline
    WHERE preferences.timezone IS NOT excluded.timezone
        OR preferences.theme IS NOT excluded.theme
        OR preferences.locale IS NOT excluded.locale
        OR preferences.today_layout IS NOT excluded.today_layout
        OR preferences.upcoming_layout IS NOT excluded.upcoming_layout
        OR preferences.light_theme IS NOT excluded.light_theme
        OR preferences.dark_theme IS NOT excluded.dark_theme
        OR preferences.accent IS NOT excluded.accent
        OR preferences.today_timeline IS NOT excluded.today_timeline;

    DELETE FROM projects WHERE space_id = NEW.space_id AND layer = NEW.layer AND is_inbox = 1
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.projects'));

    INSERT INTO projects (space_id, layer, id, revision, is_inbox, name,
        default_section_name, description, color, icon, archived, view, created_at, position, parent_id)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision',
        value ->> '$.isInbox', value ->> '$.data.name', value ->> '$.data.defaultSectionName',
        coalesce(value ->> '$.data.description', ''), value ->> '$.data.color',
        coalesce(value ->> '$.data.icon', 'hash'), value ->> '$.data.archived',
        value -> '$.data.view', coalesce(value ->> '$.data.createdAt', '1970-01-01T00:00:00Z'),
        value ->> '$.data.position', value ->> '$.data.parentId'
    FROM json_each(NEW.document, '$.projects')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        revision = excluded.revision,
        is_inbox = excluded.is_inbox,
        name = excluded.name,
        default_section_name = excluded.default_section_name,
        description = excluded.description,
        color = excluded.color,
        icon = excluded.icon,
        archived = excluded.archived,
        view = excluded.view,
        created_at = excluded.created_at,
        position = excluded.position,
        parent_id = excluded.parent_id
    WHERE projects.revision IS NOT excluded.revision
        OR projects.is_inbox IS NOT excluded.is_inbox
        OR projects.name IS NOT excluded.name
        OR projects.default_section_name IS NOT excluded.default_section_name
        OR projects.description IS NOT excluded.description
        OR projects.color IS NOT excluded.color
        OR projects.icon IS NOT excluded.icon
        OR projects.archived IS NOT excluded.archived
        OR projects.view IS NOT excluded.view
        OR projects.created_at IS NOT excluded.created_at
        OR projects.position IS NOT excluded.position
        OR projects.parent_id IS NOT excluded.parent_id;

    INSERT INTO sections (space_id, layer, id, project_id, revision, name, description, position)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.projectId', value ->> '$.revision',
        value ->> '$.data.name', coalesce(value ->> '$.data.description', ''), value ->> '$.data.position'
    FROM json_each(NEW.document, '$.sections')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        project_id = excluded.project_id,
        revision = excluded.revision,
        name = excluded.name,
        description = excluded.description,
        position = excluded.position
    WHERE sections.project_id IS NOT excluded.project_id
        OR sections.revision IS NOT excluded.revision
        OR sections.name IS NOT excluded.name
        OR sections.description IS NOT excluded.description
        OR sections.position IS NOT excluded.position;

    INSERT INTO tasks (space_id, layer, id, project_id, section_id, parent_id, revision, occurrence_id,
        title, description, priority, position, created_at, completed_at, due_date, due_time, recurrence_rule)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.projectId',
        value ->> '$.sectionId', value ->> '$.parentId', value ->> '$.revision',
        value ->> '$.occurrenceId', value ->> '$.data.title', value ->> '$.data.description',
        value ->> '$.data.priority', value ->> '$.data.position', value ->> '$.data.createdAt',
        value ->> '$.data.completedAt', value ->> '$.data.dueDate', value ->> '$.data.dueTime',
        value ->> '$.data.recurrenceRule'
    FROM json_each(NEW.document, '$.tasks')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        project_id = excluded.project_id,
        section_id = excluded.section_id,
        parent_id = excluded.parent_id,
        revision = excluded.revision,
        occurrence_id = excluded.occurrence_id,
        title = excluded.title,
        description = excluded.description,
        priority = excluded.priority,
        position = excluded.position,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        due_date = excluded.due_date,
        due_time = excluded.due_time,
        recurrence_rule = excluded.recurrence_rule
    WHERE tasks.project_id IS NOT excluded.project_id
        OR tasks.section_id IS NOT excluded.section_id
        OR tasks.parent_id IS NOT excluded.parent_id
        OR tasks.revision IS NOT excluded.revision
        OR tasks.occurrence_id IS NOT excluded.occurrence_id
        OR tasks.title IS NOT excluded.title
        OR tasks.description IS NOT excluded.description
        OR tasks.priority IS NOT excluded.priority
        OR tasks.position IS NOT excluded.position
        OR tasks.created_at IS NOT excluded.created_at
        OR tasks.completed_at IS NOT excluded.completed_at
        OR tasks.due_date IS NOT excluded.due_date
        OR tasks.due_time IS NOT excluded.due_time
        OR tasks.recurrence_rule IS NOT excluded.recurrence_rule;

    INSERT INTO labels (space_id, layer, id, revision, name, position)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision', value ->> '$.data.name',
        value ->> '$.data.position'
    FROM json_each(NEW.document, '$.labels')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        revision = excluded.revision,
        name = excluded.name,
        position = excluded.position
    WHERE labels.revision IS NOT excluded.revision
        OR labels.name IS NOT excluded.name
        OR labels.position IS NOT excluded.position;

    INSERT INTO task_labels (space_id, layer, task_id, label_id, position)
    SELECT NEW.space_id, NEW.layer, link.value ->> '$[0]', label.value, label.key
    FROM json_each(NEW.document, '$.taskLabels') AS link
    CROSS JOIN json_each(link.value, '$[1]') AS label
    WHERE 1
    ON CONFLICT (space_id, layer, task_id, label_id) DO UPDATE SET
        position = excluded.position
    WHERE task_labels.position IS NOT excluded.position;

    INSERT INTO completed_occurrences (space_id, layer, task_id, occurrence_id, nominal_date,
        due_date, due_time, completed_at, next_occurrence_id)
    SELECT NEW.space_id, NEW.layer, value ->> '$.taskId', value ->> '$.occurrenceId',
        value ->> '$.data.nominalDate', value ->> '$.data.dueDate', value ->> '$.data.dueTime',
        value ->> '$.data.completedAt', value ->> '$.data.nextOccurrenceId'
    FROM json_each(NEW.document, '$.occurrences')
    WHERE 1
    ON CONFLICT (space_id, layer, task_id, occurrence_id) DO UPDATE SET
        nominal_date = excluded.nominal_date,
        due_date = excluded.due_date,
        due_time = excluded.due_time,
        completed_at = excluded.completed_at,
        next_occurrence_id = excluded.next_occurrence_id
    WHERE completed_occurrences.nominal_date IS NOT excluded.nominal_date
        OR completed_occurrences.due_date IS NOT excluded.due_date
        OR completed_occurrences.due_time IS NOT excluded.due_time
        OR completed_occurrences.completed_at IS NOT excluded.completed_at
        OR completed_occurrences.next_occurrence_id IS NOT excluded.next_occurrence_id;

    INSERT INTO task_comments (space_id, layer, id, task_id, revision, body, created_at, edited_at)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.taskId', value ->> '$.revision',
        value ->> '$.data.body', value ->> '$.data.createdAt', value ->> '$.data.editedAt'
    FROM json_each(NEW.document, '$.comments')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        task_id = excluded.task_id,
        revision = excluded.revision,
        body = excluded.body,
        created_at = excluded.created_at,
        edited_at = excluded.edited_at
    WHERE task_comments.task_id IS NOT excluded.task_id
        OR task_comments.revision IS NOT excluded.revision
        OR task_comments.body IS NOT excluded.body
        OR task_comments.created_at IS NOT excluded.created_at
        OR task_comments.edited_at IS NOT excluded.edited_at;

    DELETE FROM task_labels WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND (task_id, label_id) NOT IN (
            SELECT link.value ->> '$[0]', label.value FROM json_each(NEW.document, '$.taskLabels') AS link
            JOIN json_each(link.value, '$[1]') AS label
        );

    DELETE FROM completed_occurrences WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND (task_id, occurrence_id) NOT IN (
            SELECT value ->> '$.taskId', value ->> '$.occurrenceId' FROM json_each(NEW.document, '$.occurrences')
        );

    DELETE FROM task_comments WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.comments'));

    DELETE FROM tasks WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.tasks'));

    DELETE FROM sections WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.sections'));

    DELETE FROM labels WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.labels'));

    DELETE FROM projects WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.projects'));
END;

CREATE VIEW workspace_layers AS
SELECT p.space_id, p.layer, json_object(
    'preferences', json_patch(json_object('timezone', p.timezone, 'theme', p.theme), json_object(
        'locale', p.locale, 'todayLayout', p.today_layout, 'upcomingLayout', p.upcoming_layout,
        'lightTheme', p.light_theme, 'darkTheme', p.dark_theme, 'accent', p.accent,
        'todayTimeline', CASE p.today_timeline WHEN 1 THEN json('true') WHEN 0 THEN json('false') END)),
    'projects', json((
        SELECT json_group_array(json_object(
            'id', id, 'revision', revision, 'isInbox', json(iif(is_inbox, 'true', 'false')),
            'data', json_patch(json_object(
                'name', name, 'defaultSectionName', default_section_name, 'description', description,
                'color', color, 'icon', icon, 'archived', json(iif(archived, 'true', 'false')),
                'view', json(view), 'createdAt', created_at
            ), json_object('position', position, 'parentId', parent_id))
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
        SELECT json_group_array(json_object('id', id, 'revision', revision,
            'data', json_patch(json_object('name', name), json_object('position', position))))
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
    )),
    'comments', json((
        SELECT json_group_array(json_object('id', id, 'taskId', task_id, 'revision', revision,
            'data', json_object('body', body, 'createdAt', created_at, 'editedAt', edited_at)
        )) FROM task_comments WHERE space_id = p.space_id AND layer = p.layer
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
