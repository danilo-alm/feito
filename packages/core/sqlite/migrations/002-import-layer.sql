-- This view is a command for seeding one empty layer. Neither the source
-- document nor a copy of the original encrypted blob is stored in SQLite.
CREATE VIEW import_workspace_layer (space_id, layer, document) AS
SELECT NULL, NULL, NULL WHERE 0;

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
        THEN RAISE(ABORT, 'Invalid workspace document') END;

    INSERT INTO preferences (space_id, layer, timezone, theme, locale)
    VALUES (NEW.space_id, NEW.layer,
        json_extract(NEW.document, '$.preferences.timezone'),
        json_extract(NEW.document, '$.preferences.theme'),
        json_extract(NEW.document, '$.preferences.locale'));

    INSERT INTO projects (space_id, layer, id, revision, is_inbox, name,
        default_section_name, description, color, icon, archived, view, created_at)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision',
        value ->> '$.isInbox', value ->> '$.data.name', value ->> '$.data.defaultSectionName',
        coalesce(value ->> '$.data.description', ''), value ->> '$.data.color',
        coalesce(value ->> '$.data.icon', 'hash'), value ->> '$.data.archived',
        value -> '$.data.view', coalesce(value ->> '$.data.createdAt', '1970-01-01T00:00:00Z')
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

    INSERT INTO labels (space_id, layer, id, revision, name)
    SELECT NEW.space_id, NEW.layer, value ->> '$.id', value ->> '$.revision', value ->> '$.data.name'
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
END;

CREATE VIEW import_workspace_profile (document) AS
SELECT NULL WHERE 0;

CREATE TRIGGER import_workspace_profile_insert
INSTEAD OF INSERT ON import_workspace_profile
BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM selection) OR EXISTS (SELECT 1 FROM spaces)
        THEN RAISE(ABORT, 'SQLite destination already contains a profile') END;
    SELECT CASE WHEN json_type(NEW.document, '$.selection') IS NOT 'object'
        OR json_type(NEW.document, '$.remotes') IS NOT 'array'
        THEN RAISE(ABORT, 'Invalid workspace profile') END;

    INSERT INTO spaces (id, kind)
    SELECT NEW.document ->> '$.local.id', 'local'
    WHERE json_type(NEW.document, '$.local') = 'object';

    INSERT INTO spaces (id, kind, origin, account_id, account_email, server_order)
    SELECT value ->> '$.id', 'remote', value ->> '$.origin',
        value ->> '$.user.id', value ->> '$.user.email', value ->> '$.order'
    FROM json_each(NEW.document, '$.remotes');

    INSERT INTO spaces (id, kind, origin, account_id, account_email)
    SELECT NEW.document ->> '$.accountWithoutReplica.id', 'remote', NEW.document ->> '$.accountWithoutReplica.origin',
        NEW.document ->> '$.accountWithoutReplica.user.id', NEW.document ->> '$.accountWithoutReplica.user.email'
    WHERE json_type(NEW.document, '$.accountWithoutReplica') = 'object';

    INSERT INTO replica_state (space_id, cursor, notice, next_sequence)
    SELECT value ->> '$.id', value ->> '$.cursor', value ->> '$.notice',
        json_array_length(value, '$.pending') + 1
    FROM json_each(NEW.document, '$.remotes');

    INSERT INTO import_workspace_layer (space_id, layer, document)
    SELECT NEW.document ->> '$.local.id', 'working', NEW.document -> '$.local.workspace'
    WHERE json_type(NEW.document, '$.local') = 'object';

    INSERT INTO import_workspace_layer (space_id, layer, document)
    SELECT value ->> '$.id', 'confirmed', value -> '$.confirmed'
    FROM json_each(NEW.document, '$.remotes');

    INSERT INTO import_workspace_layer (space_id, layer, document)
    SELECT value ->> '$.id', 'working', value -> '$.working'
    FROM json_each(NEW.document, '$.remotes');

    INSERT INTO pending_operations (space_id, sequence, id, method, path, authored_at, body, generated_ids)
    SELECT remote.value ->> '$.id', operation.key + 1, operation.value ->> '$.id',
        operation.value ->> '$.method', operation.value ->> '$.path', operation.value ->> '$.authoredAt',
        operation.value -> '$.body', operation.value -> '$.generatedIds'
    FROM json_each(NEW.document, '$.remotes') AS remote
    CROSS JOIN json_each(remote.value, '$.pending') AS operation;

    INSERT INTO import_receipts (space_id, id, binding, result)
    SELECT NEW.document ->> '$.local.id', key, value ->> '$.binding', value -> '$.result'
    FROM json_each(NEW.document, '$.local.imports');

    INSERT INTO selection (id, generation, epoch, space_id, current_server_id, discover_session, revoke_session)
    VALUES (1, NEW.document ->> '$.selection.generation', NEW.document ->> '$.selection.epoch',
        NEW.document ->> '$.selection.spaceId', NEW.document ->> '$.selection.currentServerId',
        NEW.document ->> '$.selection.discoverSession', NEW.document ->> '$.selection.revokeSession');
END;
