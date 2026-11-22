CREATE TABLE proof_tasks (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL
) STRICT;

CREATE INDEX proof_tasks_by_project ON proof_tasks (project_id, id);

CREATE TABLE proof_operations (
    sequence INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    task_id INTEGER NOT NULL REFERENCES proof_tasks (id),
    title TEXT NOT NULL
) STRICT;
