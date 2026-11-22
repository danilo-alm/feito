INSERT INTO spaces (id, kind, origin, account_id, account_email)
VALUES ('remote', 'remote', 'https://synthetic.invalid', 'account', 'synthetic@example.invalid'),
       ('other', 'remote', 'https://other.invalid', 'account', 'synthetic@example.invalid');

INSERT INTO selection (id, generation, epoch, space_id, current_server_id, discover_session)
VALUES (1, 12, 'epoch', 'remote', 'remote', 0);

INSERT INTO replica_state (space_id, cursor) VALUES ('remote', 500), ('other', 700);

INSERT INTO preferences (space_id, layer, timezone, theme) VALUES
    ('remote', 'working', 'America/Maceio', 'dark'),
    ('remote', 'confirmed', 'America/Maceio', 'dark'),
    ('other', 'working', 'UTC', 'system');

INSERT INTO projects (space_id, layer, id, revision, is_inbox, name, description, icon, archived, view, created_at)
SELECT space_id, layer, 'project', 1, 1, 'Inbox', '', 'hash', 0,
       '{"layout":"list","sortMode":"manual","showCompleted":false}', '2026-01-01T00:00:00Z'
FROM preferences;

INSERT INTO tasks (space_id, layer, id, project_id, revision, title, description, priority, position, created_at)
SELECT space_id, layer, 'task', 'project', 1, 'Original task', '', 4, 1, '2026-01-01T00:00:00Z'
FROM preferences;

INSERT INTO labels (space_id, layer, id, revision, name)
VALUES ('remote', 'working', 'label', 1, 'Synthetic label');

INSERT INTO task_labels (space_id, layer, task_id, label_id, position)
VALUES ('remote', 'working', 'task', 'label', 0);

INSERT INTO import_receipts (space_id, id, binding, result)
VALUES ('remote', 'import', 'fixture-binding', '{"projectId":"project"}');
