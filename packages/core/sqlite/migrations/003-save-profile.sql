CREATE VIEW save_workspace_layer (space_id, layer, document) AS
SELECT NULL, NULL, NULL WHERE 0;

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
        THEN RAISE(ABORT, 'Invalid workspace document') END;

    INSERT INTO preferences (space_id, layer, timezone, theme, locale)
    VALUES (NEW.space_id, NEW.layer,
        json_extract(NEW.document, '$.preferences.timezone'),
        json_extract(NEW.document, '$.preferences.theme'),
        json_extract(NEW.document, '$.preferences.locale'))
    ON CONFLICT (space_id, layer) DO UPDATE SET
        timezone = excluded.timezone,
        theme = excluded.theme,
        locale = excluded.locale
    WHERE preferences.timezone IS NOT excluded.timezone
        OR preferences.theme IS NOT excluded.theme
        OR preferences.locale IS NOT excluded.locale;

    DELETE FROM projects WHERE space_id = NEW.space_id AND layer = NEW.layer AND is_inbox = 1
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.projects'));

    INSERT INTO projects (space_id, layer, id, revision, is_inbox, name,
        default_section_name, description, color, icon, archived, view, created_at)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision',
        value ->> '$.isInbox', value ->> '$.data.name', value ->> '$.data.defaultSectionName',
        coalesce(value ->> '$.data.description', ''), value ->> '$.data.color',
        coalesce(value ->> '$.data.icon', 'hash'), value ->> '$.data.archived',
        value -> '$.data.view', coalesce(value ->> '$.data.createdAt', '1970-01-01T00:00:00Z')
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
        created_at = excluded.created_at
    WHERE projects.revision IS NOT excluded.revision
        OR projects.is_inbox IS NOT excluded.is_inbox
        OR projects.name IS NOT excluded.name
        OR projects.default_section_name IS NOT excluded.default_section_name
        OR projects.description IS NOT excluded.description
        OR projects.color IS NOT excluded.color
        OR projects.icon IS NOT excluded.icon
        OR projects.archived IS NOT excluded.archived
        OR projects.view IS NOT excluded.view
        OR projects.created_at IS NOT excluded.created_at;

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

    INSERT INTO labels (space_id, layer, id, revision, name)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision', value ->> '$.data.name'
    FROM json_each(NEW.document, '$.labels')
    WHERE 1
    ON CONFLICT (space_id, layer, id) DO UPDATE SET
        revision = excluded.revision,
        name = excluded.name
    WHERE labels.revision IS NOT excluded.revision
        OR labels.name IS NOT excluded.name;

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

    DELETE FROM task_labels WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND (task_id, label_id) NOT IN (
            SELECT link.value ->> '$[0]', label.value FROM json_each(NEW.document, '$.taskLabels') AS link
            JOIN json_each(link.value, '$[1]') AS label
        );

    DELETE FROM completed_occurrences WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND (task_id, occurrence_id) NOT IN (
            SELECT value ->> '$.taskId', value ->> '$.occurrenceId' FROM json_each(NEW.document, '$.occurrences')
        );

    DELETE FROM tasks WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.tasks'));

    DELETE FROM sections WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.sections'));

    DELETE FROM labels WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.labels'));

    DELETE FROM projects WHERE space_id = NEW.space_id AND layer = NEW.layer
        AND id NOT IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.projects'));
END;

-- Accepts a profile fragment. Only the supplied layers are reconciled;
-- absent spaces remain unless an explicit deletion or full replacement is requested.
CREATE VIEW save_workspace_profile (document) AS
SELECT NULL WHERE 0;

CREATE TRIGGER save_workspace_profile_insert
INSTEAD OF INSERT ON save_workspace_profile
BEGIN
    DELETE FROM spaces
    WHERE (NEW.document ->> '$.replaceSpaces') = 1
      AND id IS NOT (NEW.document ->> '$.local.id')
      AND NOT EXISTS (SELECT 1 FROM json_each(NEW.document, '$.remotes') WHERE value ->> '$.id' = spaces.id);

    INSERT INTO spaces (id, kind)
    SELECT NEW.document ->> '$.local.id', 'local'
    WHERE json_type(NEW.document, '$.local') = 'object'
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO spaces (id, kind, origin, account_id, account_email, server_order)
    SELECT value ->> '$.id', 'remote', value ->> '$.origin',
           value ->> '$.user.id', value ->> '$.user.email', value ->> '$.order'
    FROM json_each(NEW.document, '$.remotes')
    WHERE 1
    ON CONFLICT (id) DO UPDATE SET account_email = excluded.account_email, server_order = excluded.server_order
    WHERE spaces.account_email IS NOT excluded.account_email OR spaces.server_order IS NOT excluded.server_order;

    INSERT INTO replica_state (space_id, cursor, notice)
    SELECT value ->> '$.id', value ->> '$.cursor', value ->> '$.notice'
    FROM json_each(NEW.document, '$.remotes')
    WHERE json_type(value, '$.confirmed') = 'object'
    ON CONFLICT (space_id) DO UPDATE SET cursor = excluded.cursor, notice = excluded.notice
    WHERE replica_state.cursor IS NOT excluded.cursor OR replica_state.notice IS NOT excluded.notice;

    INSERT INTO save_workspace_layer (space_id, layer, document)
    SELECT NEW.document ->> '$.local.id', 'working', NEW.document -> '$.local.workspace'
    WHERE json_type(NEW.document, '$.local.workspace') = 'object';

    INSERT INTO save_workspace_layer (space_id, layer, document)
    SELECT value ->> '$.id', 'confirmed', value -> '$.confirmed'
    FROM json_each(NEW.document, '$.remotes') WHERE json_type(value, '$.confirmed') = 'object';

    INSERT INTO save_workspace_layer (space_id, layer, document)
    SELECT value ->> '$.id', 'working', value -> '$.working'
    FROM json_each(NEW.document, '$.remotes') WHERE json_type(value, '$.working') = 'object';

    DELETE FROM pending_operations
    WHERE EXISTS (
        SELECT 1 FROM json_each(NEW.document, '$.remotes') AS remote
        WHERE remote.value ->> '$.id' = pending_operations.space_id
            AND json_type(remote.value, '$.pending') = 'array'
            AND NOT EXISTS (
                SELECT 1 FROM json_each(remote.value, '$.pending')
                WHERE value ->> '$.id' = pending_operations.id
            )
    );

    INSERT INTO pending_operations (space_id, sequence, id, method, path, authored_at, body, generated_ids)
    SELECT
        space_id, next_sequence + row_number() OVER (PARTITION BY space_id ORDER BY ordinal) - 1,
        operation ->> '$.id', operation ->> '$.method', operation ->> '$.path',
        operation ->> '$.authoredAt', operation -> '$.body', operation -> '$.generatedIds'
    FROM (
        SELECT remote.value ->> '$.id' AS space_id, operation.key AS ordinal, operation.value AS operation,
               replica_state.next_sequence
        FROM json_each(NEW.document, '$.remotes') AS remote
        JOIN replica_state ON replica_state.space_id = remote.value ->> '$.id'
        JOIN json_each(remote.value, '$.pending') AS operation
        WHERE NOT EXISTS (
            SELECT 1 FROM pending_operations
            WHERE pending_operations.space_id = replica_state.space_id AND id = operation.value ->> '$.id'
        )
    );

    UPDATE replica_state
    SET next_sequence = (
        SELECT max(sequence) + 1 FROM pending_operations WHERE pending_operations.space_id = replica_state.space_id
    )
    WHERE space_id IN (SELECT value ->> '$.id' FROM json_each(NEW.document, '$.remotes'))
        AND (SELECT max(sequence) FROM pending_operations WHERE pending_operations.space_id = replica_state.space_id) >= next_sequence;

    INSERT INTO import_receipts (space_id, id, binding, result)
    SELECT NEW.document ->> '$.local.id', key, value ->> '$.binding', value -> '$.result'
    FROM json_each(NEW.document, '$.local.imports')
    WHERE 1
    ON CONFLICT (space_id, id) DO UPDATE SET binding = excluded.binding, result = excluded.result
    WHERE import_receipts.binding IS NOT excluded.binding OR import_receipts.result IS NOT excluded.result;

    INSERT INTO selection (id, generation, epoch, space_id, current_server_id, discover_session, revoke_session)
    VALUES (1, NEW.document ->> '$.selection.generation', NEW.document ->> '$.selection.epoch',
        NEW.document ->> '$.selection.spaceId', NEW.document ->> '$.selection.currentServerId',
        NEW.document ->> '$.selection.discoverSession', NEW.document ->> '$.selection.revokeSession')
    ON CONFLICT (id) DO UPDATE SET generation = excluded.generation, epoch = excluded.epoch,
        space_id = excluded.space_id, current_server_id = excluded.current_server_id,
        discover_session = excluded.discover_session, revoke_session = excluded.revoke_session;

    DELETE FROM spaces WHERE id = NEW.document ->> '$.deleteSpace';
END;
