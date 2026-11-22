CREATE TABLE spaces (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'remote')),
    origin TEXT,
    account_id TEXT,
    account_email TEXT,
    server_order INTEGER CHECK (server_order >= 0),
    CHECK ((kind = 'local' AND origin IS NULL AND account_id IS NULL AND account_email IS NULL AND server_order IS NULL)
        OR (kind = 'remote' AND origin IS NOT NULL AND account_id IS NOT NULL AND account_email IS NOT NULL)),
    UNIQUE (origin, account_id)
) STRICT;

CREATE UNIQUE INDEX one_local_space ON spaces (kind) WHERE kind = 'local';

CREATE TABLE selection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL CHECK (generation BETWEEN 0 AND 9007199254740991),
    epoch TEXT NOT NULL,
    space_id TEXT REFERENCES spaces (id) DEFERRABLE INITIALLY DEFERRED,
    current_server_id TEXT REFERENCES spaces (id) DEFERRABLE INITIALLY DEFERRED,
    discover_session INTEGER NOT NULL CHECK (discover_session IN (0, 1)),
    revoke_session TEXT
) STRICT;

CREATE TABLE replica_state (
    space_id TEXT PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
    cursor INTEGER NOT NULL CHECK (cursor BETWEEN 0 AND 9007199254740991),
    notice TEXT,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence BETWEEN 1 AND 9007199254740991)
) STRICT;

CREATE TABLE preferences (
    space_id TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    layer TEXT NOT NULL CHECK (layer IN ('working', 'confirmed')),
    timezone TEXT NOT NULL,
    theme TEXT NOT NULL CHECK (theme IN ('system', 'light', 'dark')),
    locale TEXT,
    PRIMARY KEY (space_id, layer)
) STRICT, WITHOUT ROWID;

CREATE TABLE projects (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    is_inbox INTEGER NOT NULL CHECK (is_inbox IN (0, 1)),
    name TEXT NOT NULL,
    default_section_name TEXT,
    description TEXT NOT NULL,
    color TEXT,
    icon TEXT NOT NULL,
    archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
    view TEXT NOT NULL CHECK (json_valid(view)),
    created_at TEXT NOT NULL,
    PRIMARY KEY (space_id, layer, id),
    FOREIGN KEY (space_id, layer) REFERENCES preferences (space_id, layer) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE UNIQUE INDEX projects_inbox ON projects (space_id, layer) WHERE is_inbox = 1;

CREATE TABLE sections (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (space_id, layer, id),
    UNIQUE (space_id, layer, project_id, id),
    FOREIGN KEY (space_id, layer, project_id) REFERENCES projects (space_id, layer, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE INDEX sections_by_project ON sections (space_id, layer, project_id, position, id);

CREATE TABLE tasks (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    section_id TEXT,
    parent_id TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    occurrence_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    due_date TEXT,
    due_time TEXT CHECK (due_time IS NULL OR due_date IS NOT NULL),
    recurrence_rule TEXT CHECK (recurrence_rule IS NULL OR json_valid(recurrence_rule)),
    PRIMARY KEY (space_id, layer, id),
    UNIQUE (space_id, layer, project_id, id),
    FOREIGN KEY (space_id, layer, project_id) REFERENCES projects (space_id, layer, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (space_id, layer, project_id, section_id) REFERENCES sections (space_id, layer, project_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (space_id, layer, project_id, parent_id) REFERENCES tasks (space_id, layer, project_id, id)
        DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE INDEX tasks_by_project ON tasks (space_id, layer, project_id, section_id, parent_id, position, id);
CREATE INDEX tasks_by_parent ON tasks (space_id, layer, parent_id, position, id);
CREATE INDEX tasks_by_due_date ON tasks (space_id, layer, due_date, id)
    WHERE completed_at IS NULL AND due_date IS NOT NULL;

CREATE TABLE labels (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    PRIMARY KEY (space_id, layer, id),
    FOREIGN KEY (space_id, layer) REFERENCES preferences (space_id, layer) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE task_labels (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    task_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (space_id, layer, task_id, label_id),
    FOREIGN KEY (space_id, layer, task_id) REFERENCES tasks (space_id, layer, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (space_id, layer, label_id) REFERENCES labels (space_id, layer, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE INDEX task_labels_by_task ON task_labels (space_id, layer, task_id, position, label_id);
CREATE INDEX task_labels_by_label ON task_labels (space_id, layer, label_id, task_id);

CREATE TABLE completed_occurrences (
    space_id TEXT NOT NULL,
    layer TEXT NOT NULL,
    task_id TEXT NOT NULL,
    occurrence_id TEXT NOT NULL,
    nominal_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    due_time TEXT,
    completed_at TEXT NOT NULL,
    next_occurrence_id TEXT,
    PRIMARY KEY (space_id, layer, task_id, occurrence_id),
    FOREIGN KEY (space_id, layer, task_id) REFERENCES tasks (space_id, layer, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;

CREATE TABLE pending_operations (
    space_id TEXT NOT NULL REFERENCES replica_state (space_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
    id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    authored_at TEXT NOT NULL,
    body TEXT CHECK (body IS NULL OR json_valid(body)),
    generated_ids TEXT CHECK (generated_ids IS NULL OR json_valid(generated_ids)),
    PRIMARY KEY (space_id, sequence),
    UNIQUE (space_id, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE import_receipts (
    space_id TEXT NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    binding TEXT NOT NULL,
    result TEXT NOT NULL CHECK (json_valid(result)),
    PRIMARY KEY (space_id, id)
) STRICT, WITHOUT ROWID;
