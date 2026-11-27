import { readFileSync } from "node:fs";
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSqliteStorage, migrateSqlite, queryFiles } from "../../src/browser/sqlite/storage";
import type { SQLiteTitleEdit } from "@feito/core/product/sqlite-batches";

const common = new URL("../../../../packages/core/sqlite/", import.meta.url);
const readSql = (file: string) => readFileSync(new URL(file, common), "utf8");
const migrations = [
  readSql("migrations/001-initial.sql"),
  readSql("migrations/002-import-layer.sql"),
  readSql("migrations/003-save-profile.sql"),
  readSql("migrations/004-read-profile.sql"),
  readSql("migrations/005-manual-order.sql"),
  readSql("migrations/006-agenda-layouts.sql"),
  readSql("migrations/007-parent-projects.sql"),
  readSql("migrations/008-task-comments.sql"),
  readSql("migrations/009-appearance.sql"),
];
const fixture = readFileSync(new URL("../../../../scripts/sqlite-proof/relational-fixture.sql", import.meta.url), "utf8");
const queries = Object.fromEntries(
  Object.entries(queryFiles).map(([key, file]) => [key, readSql("queries/" + file)]),
) as Parameters<typeof createSqliteStorage>[1];
const edit: SQLiteTitleEdit = {
  selection: { spaceId: "remote", epoch: "epoch", generation: 12 },
  taskId: "task", revision: 1, title: "Updated title",
  operation: {
    id: "op", method: "PATCH", path: "/tasks/task", authoredAt: "2026-11-22T00:00:00Z",
    body: { title: "Updated title", revision: 1 },
  },
};

describe("shared offline SQLite workspace", () => {
  let sqlite: Awaited<ReturnType<typeof sqlite3InitModule>>;
  let db: Database;
  let store: ReturnType<typeof createSqliteStorage>;

  beforeAll(async () => { sqlite = await sqlite3InitModule(); });
  beforeEach(() => {
    db = new sqlite.oo1.DB();
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    db.exec(fixture);
    store = createSqliteStorage(db, queries);
  });
  afterEach(() => db?.close());

  it("applies the version transactionally and rejects unknown storage without overwriting it", () => {
    expect(db.selectValue("PRAGMA user_version")).toBe(migrations.length);
    expect(db.selectValue("PRAGMA foreign_keys")).toBe(1);
    expect(db.selectValue("PRAGMA secure_delete")).toBe(1);
    expect(() => migrateSqlite(db, 3_037_000, migrations)).toThrow(/3.38/);
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const second = new sqlite.oo1.DB();
    try {
      expect(() => migrateSqlite(second, sqlite.version.libVersionNumber, ["CREATE TABLE marker (id); INVALID;"])).toThrow();
      expect(second.selectValue("SELECT 1 FROM sqlite_schema")).toBeUndefined();
      second.exec(`PRAGMA user_version = ${migrations.length + 1}; CREATE TABLE marker (id);`);
      expect(() => migrateSqlite(second, sqlite.version.libVersionNumber, migrations)).toThrow(/Unsupported/);
      expect(second.selectValue("SELECT name FROM sqlite_schema")).toBe("marker");
      expect(second.selectValue("PRAGMA user_version")).toBe(migrations.length + 1);
    } finally {
      second.close();
    }
  });

  it("keeps working reads in scope and uses project, detail and parent indexes", () => {
    expect(store.readTask(edit.selection, "task")).toMatchObject({ title: "Original task", revision: 1 });
    expect(store.readProjectTasks(edit.selection, "project")).toHaveLength(1);
    expect(store.readProjectTasks({ ...edit.selection, spaceId: "other" }, "project")).toBeUndefined();
    for (const [sql, key, plan] of [
      [queries.task, "task", "PRIMARY KEY"],
      [queries.projectTasks, "project", "tasks_by_project"],
      [queries.children, "task", "tasks_by_parent"],
    ]) {
      expect(db.selectObjects("EXPLAIN QUERY PLAN " + sql, ["remote", "working", key])
        .some(({ detail }) => String(detail).includes(plan))).toBe(true);
    }
  });

  it("rolls back task, generation and queue when an operation cannot be persisted", () => {
    db.exec("CREATE TEMP TRIGGER fail_queue BEFORE INSERT ON pending_operations BEGIN SELECT RAISE(ABORT, 'forced'); END");
    expect(() => store.commitTitle(edit)).toThrow(/forced/);
    expect(store.readTask(edit.selection, "task")).toMatchObject({ title: "Original task", revision: 1 });
    expect(db.selectValue("SELECT count(*) FROM pending_operations")).toBe(0);
    expect(db.selectValue("SELECT next_sequence FROM replica_state WHERE space_id = 'remote'")).toBe(1);
  });

  it("commits one working task and operation and handles a retry with the same ID", () => {
    expect(store.commitTitle(edit)).toEqual({ generation: 13, revision: 2 });
    expect(store.commitTitle(edit)).toBe("duplicate");
    expect(() => store.commitTitle({ ...edit, operation: { ...edit.operation!, path: "/tasks/another" } })).toThrow(/ID reused/);
    expect(db.selectValues("SELECT title FROM tasks ORDER BY space_id, layer"))
      .toEqual(["Original task", "Original task", "Updated title"]);
    expect(db.selectObjects("SELECT id, sequence FROM pending_operations")).toEqual([{ id: "op", sequence: 1 }]);
    expect(db.selectValue("SELECT next_sequence FROM replica_state WHERE space_id = 'remote'")).toBe(2);
    expect(db.selectValue("SELECT cursor FROM replica_state WHERE space_id = 'remote'")).toBe(500);
  });

  it("rejects stale selection after logout and preserves other spaces", () => {
    expect(store.commitTitle(edit)).toEqual({ generation: 13, revision: 2 });
    db.transaction(() => db.exec(`
      UPDATE selection SET generation = 14, epoch = 'signed-out', space_id = NULL, current_server_id = NULL,
          revoke_session = 'account';
      DELETE FROM spaces WHERE id = 'remote';
    `));
    expect(store.commitTitle(edit)).toBe("conflict");
    expect(db.selectValue("SELECT count(*) FROM task_labels")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM pending_operations")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM import_receipts")).toBe(0);
    expect(db.selectValue("SELECT title FROM tasks WHERE space_id = 'other'")).toBe("Original task");
  });

  it("rejects a late edit after a task is deleted", () => {
    db.exec("DELETE FROM tasks WHERE space_id = 'remote' AND layer = 'working'");
    expect(store.commitTitle(edit)).toBe("conflict");
    expect(db.selectValue("SELECT count(*) FROM pending_operations")).toBe(0);
  });
});

it("converts working and confirmed layers, pending operations and receipts in one transaction", async () => {
  const { newWorkspace } = await import("@feito/core/product/local-workspace");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createSqliteStorage(db, queries);
    const workspace = newWorkspace();
    const projectId = workspace.projects[0].id;
    const task = {
      projectId, id: "task", revision: 7, sectionId: null, parentId: null, occurrenceId: "next",
      data: {
        title: "Recurring task", description: "Details", priority: 3 as const, position: 4,
        createdAt: "2026-01-01T00:00:00Z", completedAt: null, dueDate: "2026-11-23", dueTime: "09:00",
        recurrenceRule: { frequency: "daily" as const, anchorDate: "2026-11-22", nominalDate: "2026-11-23", time: "09:00" },
      },
    };
    workspace.tasks = [task];
    workspace.labels = [{ id: "first", revision: 1, data: { name: "First" } }, { id: "second", revision: 1, data: { name: "Second" } }];
    workspace.taskLabels = [[task.id, ["second", "first"]]];
    workspace.occurrences = [{
      taskId: task.id, occurrenceId: "prior", data: {
        nominalDate: "2026-11-22", dueDate: "2026-11-22", dueTime: "09:00",
        completedAt: "2026-11-22T12:00:00Z", nextOccurrenceId: "next",
      },
    }];

    const receipt = {
      binding: "backup:synthetic",
      result: { operationId: "import", summary: { projects: 1, archivedProjects: 0, sections: 0, tasks: 1, completedTasks: 0, labels: 2, occurrences: 1 } },
    };
    const source = {
      selection: { generation: 100, epoch: "epoch", spaceId: "account:one", discoverSession: false, revokeSession: "signed-out" },
      local: { id: "local", workspace, imports: { import: receipt } },
      remotes: [
        {
          id: "account:one", origin: "https://synthetic.invalid", user: { id: "one", email: "one@example.invalid" },
          cursor: 777, confirmed: { ...workspace, tasks: [{ ...task, revision: 6 }] }, working: workspace,
          pending: [{ ...edit.operation!, generatedIds: ["stable-id"] }, { ...edit.operation!, id: "next" }],
        },
        {
          id: "account:two", origin: "https://synthetic.invalid", user: { id: "two", email: "two@example.invalid" },
          cursor: 778, confirmed: workspace, working: workspace,
          pending: [{ ...edit.operation!, id: "other" }],
        },
      ],
    };
    const wrong = structuredClone(source);
    wrong.remotes[0].working.taskLabels = [["task", ["missing"]]];
    expect(() => store.importProfile(wrong)).toThrow();
    expect(db.selectValue("SELECT count(*) FROM spaces")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM pending_operations")).toBe(0);

    store.importProfile(source);
    expect(() => store.importProfile(source)).toThrow(/already contains/);
    expect(store.readTask(source.selection, "task")).toMatchObject({
      id: "task", revision: 7, title: "Recurring task", due_date: "2026-11-23", due_time: "09:00", occurrence_id: "next",
    });
    expect(db.selectValue("SELECT revision FROM tasks WHERE space_id = 'account:one' AND layer = 'confirmed'")).toBe(6);
    expect(db.selectValues("SELECT label_id FROM task_labels WHERE space_id = 'local' ORDER BY position")).toEqual(["second", "first"]);
    expect(db.selectValue("SELECT completed_at FROM completed_occurrences WHERE space_id = 'local'")).toBe("2026-11-22T12:00:00Z");
    expect(db.selectValues("SELECT id FROM pending_operations ORDER BY space_id, sequence")).toEqual(["op", "next", "other"]);
    expect(db.selectValue("SELECT generated_ids FROM pending_operations WHERE id = 'op'")).toBe('["stable-id"]');
    expect(db.selectValue("SELECT binding FROM import_receipts")).toBe(receipt.binding);
    expect(JSON.parse(String(db.selectValue("SELECT result FROM import_receipts")))).toEqual(receipt.result);
    expect(db.selectValue("SELECT revoke_session FROM selection")).toBe("signed-out");
    expect(db.selectObjects("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});

it("uses the same task detail, validation and optimistic changes as the complete workspace executor", async () => {
  const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createSqliteStorage(db, queries);
    let workspace = newWorkspace();
    const created = await handleLocal(workspace, { method: "POST", path: "/tasks", body: { title: "Root task" } });
    workspace = created.workspace;
    const taskId = workspace.tasks[0].id;
    for (const name of ["Child", "Grandchild", "Unrelated"]) {
      const parentId = name === "Child" ? taskId : name === "Grandchild" ? workspace.tasks.at(-1)?.id : undefined;
      workspace = (await handleLocal(workspace, {
        method: "POST", path: "/tasks", body: { title: name, parentId },
      })).workspace;
    }
    const selection = { generation: 12, epoch: "epoch", spaceId: "account:one", discoverSession: false };
    store.importProfile({
      selection,
      remotes: [{
        id: selection.spaceId, origin: "https://synthetic.invalid", user: { id: "one", email: "one@example.invalid" },
        cursor: 44, confirmed: workspace, working: workspace, pending: [],
      }],
    });
    const request = { method: "GET", path: "/tasks/" + taskId };
    const detail = await handleLocal(workspace, request);
    expect(await store.taskDetail(selection, taskId)).toEqual({ status: detail.status, body: detail.body });

    const projectId = workspace.projects[0].id;
    const path = "/projects/" + projectId + "?includeCompleted=true";
    const project = await handleLocal(workspace, { method: "GET", path });
    expect(await store.projectDetail(selection, projectId, path)).toEqual({ status: project.status, body: project.body });

    const input = {
      id: "operation", authoredAt: "2026-11-22T00:00:00Z", taskChanges: true,
      body: { revision: workspace.tasks[0].revision, title: " Renamed root " },
    };
    const expected = await handleLocal(workspace, { ...request, ...input, method: "PATCH", revision: selection.generation });
    expect(await store.editTitle(selection, taskId, input)).toEqual({ status: expected.status, body: expected.body });
    expect(store.readQueue({ ...selection, generation: 13 })).toMatchObject([{ id: input.id, body: JSON.stringify(input.body) }]);
  } finally {
    db.close();
  }
});

it("persists product mutations, reconciles the pending prefix and erases the account without touching the local space", async () => {
  const { createProfileStorage } = await import("../../src/browser/sqlite/profile-storage");
  const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createProfileStorage(db, {
      "save-profile.sql": readSql("queries/save-profile.sql"),
      "read-profile.sql": readSql("queries/read-profile.sql"),
      "import-profile.sql": readSql("queries/import-profile.sql"),
    }, "https://synthetic.invalid");
    store.initialize();
    const local = { kind: "local" as const };
    const localWorkspace = newWorkspace();
    expect(store.commit(0, { selection: { epoch: "local", discoverSession: false, space: local },
      localIfMissing: { workspace: localWorkspace } })).toBe(true);
    const user = { id: "account", email: "test@example.invalid" };
    const selection = { epoch: "account", discoverSession: false, space: { kind: "account" as const, user } };
    expect(store.commit(1, { selection })).toBe(true);
    expect(store.read()).toEqual({ generation: 2, selection: { ...selection, revokeSession: undefined }, data: undefined });

    const confirmed = newWorkspace();
    const make = async (workspace: typeof confirmed, title: string) => (await handleLocal(workspace, {
      method: "POST", path: "/tasks", body: { title },
    })).workspace;
    const working = await make(await make(confirmed, "Task one"), "Task two");
    const op = edit.operation!;
    const replica = { user, cursor: 12, working, confirmed, pending: [
      { ...op, id: "first", body: null },
      { ...op, id: "second", body: undefined },
    ] };
    expect(store.commit(2, { data: replica })).toBe(true);
    expect(store.commit(2, {})).toBe(false);
    expect(store.read()?.data).toMatchObject({ cursor: 12, pending: [{ id: "first", body: null }, { id: "second" }] });

    db.exec("CREATE TEMP TABLE task_writes (id TEXT); CREATE TEMP TRIGGER count_tasks AFTER UPDATE ON tasks BEGIN INSERT INTO task_writes VALUES (new.id); END");
    const id = working.tasks.find((task) => task.data.title === "Task one")!.id;
    const changed = (await handleLocal(working, {
      method: "PATCH", path: "/tasks/" + id, body: { revision: 1, title: "Updated task" },
    })).workspace;
    expect(store.commit(3, { data: { ...replica, working: changed,
      pending: [replica.pending[1], { ...op, id: "third" }], cursor: 13 } })).toBe(true);
    expect(db.selectValues("SELECT id FROM task_writes")).toEqual([id]);
    expect(db.selectObjects("SELECT id, sequence FROM pending_operations ORDER BY sequence"))
      .toEqual([{ id: "second", sequence: 2 }, { id: "third", sequence: 3 }]);
    expect(store.commit(4, {
      selection: { epoch: "logout", discoverSession: false, revokeSession: "marker", space: { kind: "none" } },
      deleteAccount: user.id,
    })).toBe(true);
    expect(db.selectValues("SELECT id FROM spaces")).toEqual(["local"]);
    expect(db.selectValue("SELECT count(*) FROM pending_operations")).toBe(0);
    expect(db.selectValue("SELECT count(*) FROM tasks")).toBe(0);
    expect(store.read()?.selection.revokeSession).toBe("marker");
    expect(store.commit(5, { selection: { epoch: "back", discoverSession: false, space: local } })).toBe(true);
    expect(store.read()?.data).toMatchObject({ workspace: { projects: [{ id: localWorkspace.projects[0].id }] } });
  } finally {
    db.close();
  }
});

it("keeps the workspace readable after SQLite reports a full database", async () => {
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    db.exec(fixture);
    const store = createSqliteStorage(db, queries);
    const pages = Number(db.selectValue("PRAGMA page_count"));
    db.exec(`PRAGMA max_page_count = ${pages}`);
    const op = edit.operation!;
    expect(() => store.commitTitle({
      ...edit, operation: { ...op, body: { ...op.body as object, synthetic: "x".repeat(256 * 1024) } },
    })).toThrow(/SQLITE_FULL|database or disk is full/i);
    expect(store.readTask(edit.selection, "task")).toMatchObject({ title: "Original task", revision: 1 });
    expect(store.readQueue(edit.selection)).toEqual([]);
  } finally {
    db.close();
  }
});

it("migrates an account selected before its first server snapshot arrives", async () => {
  const { createProfileStorage } = await import("../../src/browser/sqlite/profile-storage");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createProfileStorage(db, {
      "save-profile.sql": readSql("queries/save-profile.sql"),
      "read-profile.sql": readSql("queries/read-profile.sql"),
      "import-profile.sql": readSql("queries/import-profile.sql"),
    }, "https://synthetic.invalid");
    const user = { id: "pending-download", email: "pending@example.invalid" };
    store.initialize({
      selection: { spaceId: "account:" + user.id, generation: 7, epoch: "pending", discoverSession: false },
      accountWithoutReplica: { id: "account:" + user.id, origin: "https://synthetic.invalid", user },
      remotes: [],
    });
    expect(store.read()).toEqual({
      generation: 7,
      selection: { epoch: "pending", space: { kind: "account", user }, discoverSession: false, revokeSession: undefined },
      data: undefined,
    });
    expect(store.summary()).toMatchObject({ loaded: false, pending: 0 });
  } finally {
    db.close();
  }
});

it("keeps the manual order, the agenda layouts and older data across saves, reads and the upgrade from version 4", async () => {
  const { createProfileStorage } = await import("../../src/browser/sqlite/profile-storage");
  const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations.slice(0, 4));
    const files = {
      "save-profile.sql": readSql("queries/save-profile.sql"),
      "read-profile.sql": readSql("queries/read-profile.sql"),
      "import-profile.sql": readSql("queries/import-profile.sql"),
    };
    const run = async (workspace: ReturnType<typeof newWorkspace>, method: string, path: string, body?: unknown) =>
      (await handleLocal(workspace, { method, path, body })).workspace;
    let workspace = newWorkspace();
    for (const name of ["A", "B"]) workspace = await run(workspace, "POST", "/projects", { name });
    for (const name of ["casa", "rua"]) workspace = await run(workspace, "POST", "/labels", { name });
    const before = createProfileStorage(db, files, "https://synthetic.invalid");
    before.initialize();
    const local = { kind: "local" as const };
    expect(before.commit(0, { selection: { epoch: "local", discoverSession: false, space: local },
      localIfMissing: { workspace } })).toBe(true);

    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createProfileStorage(db, files, "https://synthetic.invalid");
    store.initialize();
    const read = () => (store.read()?.data as { workspace: typeof workspace }).workspace;
    expect(read().projects.every((project) => !("position" in project.data))).toBe(true);

    const [a, b] = ["A", "B"].map((name) => workspace.projects.find((project) => project.data.name === name)!);
    const rua = workspace.labels.find((label) => label.data.name === "rua")!;
    workspace = await run(read(), "POST", `/projects/${b.id}/move`, { beforeId: a.id });
    workspace = await run(workspace, "POST", `/labels/${rua.id}/move`, {});
    workspace = await run(workspace, "PATCH", "/preferences", { todayLayout: "board", darkTheme: "nord", accent: "violet" });
    expect(store.commit(store.read()!.generation, { data: { workspace } })).toBe(true);

    const saved = read();
    expect(saved.preferences).toMatchObject({ todayLayout: "board", darkTheme: "nord", accent: "violet" });
    expect(saved.preferences).not.toHaveProperty("lightTheme");
    expect(saved.preferences).not.toHaveProperty("upcomingLayout");
    expect(saved.projects.find((project) => project.id === b.id)?.data.position).toBe(0);
    expect(saved.projects.find((project) => project.id === a.id)?.data.position).toBe(1);
    expect(saved.projects.find((project) => project.isInbox)?.data).not.toHaveProperty("position");
    const nav = (await handleLocal(saved, { method: "GET", path: "/navigation" })).body as {
      projects: { name: string }[]; labels: { name: string }[];
    };
    expect(nav.projects.map((project) => project.name)).toEqual(["B", "A"]);
    expect(nav.labels.map((label) => label.name)).toEqual(["casa", "rua"]);
    expect(db.selectObjects("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});

it("keeps the parent project across saves, reads, project context and the upgrade from version 6", async () => {
  const { createProfileStorage } = await import("../../src/browser/sqlite/profile-storage");
  const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations.slice(0, 6));
    const files = {
      "save-profile.sql": readSql("queries/save-profile.sql"),
      "read-profile.sql": readSql("queries/read-profile.sql"),
      "import-profile.sql": readSql("queries/import-profile.sql"),
    };
    const run = async (workspace: ReturnType<typeof newWorkspace>, method: string, path: string, body?: unknown) =>
      (await handleLocal(workspace, { method, path, body })).workspace;
    let workspace = newWorkspace();
    for (const name of ["A", "B"]) workspace = await run(workspace, "POST", "/projects", { name });
    const before = createProfileStorage(db, files, "https://synthetic.invalid");
    before.initialize();
    expect(before.commit(0, { selection: { epoch: "local", discoverSession: false, space: { kind: "local" } },
      localIfMissing: { workspace } })).toBe(true);

    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createProfileStorage(db, files, "https://synthetic.invalid");
    store.initialize();
    const read = () => (store.read()?.data as { workspace: typeof workspace }).workspace;
    expect(read().projects.every((project) => !("parentId" in project.data))).toBe(true);

    const [a, b] = ["A", "B"].map((name) => workspace.projects.find((project) => project.data.name === name)!);
    workspace = await run(read(), "POST", `/projects/${b.id}/move`, { parentId: a.id });
    expect(store.commit(store.read()!.generation, { data: { workspace } })).toBe(true);
    expect(read().projects.find((project) => project.id === b.id)?.data.parentId).toBe(a.id);
    const spaceId = db.selectValue("SELECT space_id FROM projects WHERE id = ? AND layer = 'working'", [b.id]);
    const context = JSON.parse(String(db.selectValue(queries.projectContext, [spaceId!, "working", b.id])));
    expect(context.projects[0].data.parentId).toBe(a.id);

    workspace = await run(read(), "POST", `/projects/${b.id}/move`, { parentId: null });
    expect(store.commit(store.read()!.generation, { data: { workspace } })).toBe(true);
    expect(read().projects.find((project) => project.id === b.id)?.data).not.toHaveProperty("parentId");
    expect(db.selectValue("SELECT parent_id FROM projects WHERE id = ?", [b.id])).toBeNull();
  } finally {
    db.close();
  }
});

it("stores comments in each layer, removes them with their task and reads documents saved without them", async () => {
  const { handleLocal, newWorkspace } = await import("@feito/core/product/local-executor");
  const sqlite = await sqlite3InitModule();
  const db = new sqlite.oo1.DB();
  try {
    migrateSqlite(db, sqlite.version.libVersionNumber, migrations);
    const store = createSqliteStorage(db, queries);
    let workspace = newWorkspace();
    const send = async (method: string, path: string, body?: unknown) => {
      const result = await handleLocal(workspace, { method, path, body, authoredAt: "2026-11-22T00:00:00Z" });
      workspace = result.workspace;
      return result.body as { id: string; revision: number };
    };
    const task = await send("POST", "/tasks", { title: "Commented" });
    const other = await send("POST", "/tasks", { title: "Other" });
    const comment = await send("POST", `/tasks/${task.id}/comments`, { body: "First" });
    await send("POST", `/tasks/${other.id}/comments`, { body: "Elsewhere" });
    await send("PATCH", `/comments/${comment.id}`, { revision: 1, body: "Edited" });
    const selection = { generation: 1, epoch: "epoch", spaceId: "local", discoverSession: false };
    store.importProfile({ selection, local: { id: "local", workspace }, remotes: [] });

    const readWorkspace = () => JSON.parse(String(db.selectValue(readSql("queries/read-profile.sql"), [true]))).local.workspace;
    expect(readWorkspace().comments).toEqual(expect.arrayContaining(workspace.comments!));
    expect(readWorkspace().comments).toHaveLength(2);
    const detail = await store.taskDetail({ ...selection, generation: 1 }, task.id);
    expect(detail).toMatchObject({ status: 200, body: { commentCount: 1 } });
    const listed = await handleLocal(readWorkspace(), { method: "GET", path: `/tasks/${task.id}/comments` });
    expect(listed.body).toMatchObject({ comments: [{ id: comment.id, revision: 2, body: "Edited", editedAt: expect.any(String) }] });

    const save = (document: unknown) => db.exec({
      sql: readSql("queries/save-profile.sql"),
      bind: [JSON.stringify({ selection: { ...selection, generation: 2 }, local: { id: "local", workspace: document } })],
    });
    await send("DELETE", `/tasks/${task.id}?revision=1`);
    save(workspace);
    expect(readWorkspace().comments.map(({ data }: { data: { body: string } }) => data.body)).toEqual(["Elsewhere"]);
    expect(db.selectValue("SELECT count(*) FROM task_comments")).toBe(1);

    const { comments: _comments, ...legacy } = workspace;
    save(legacy);
    expect(readWorkspace().comments).toEqual([]);
    expect(() => save({ ...legacy, comments: {} })).toThrow(/Invalid workspace document/);
    expect(db.selectObjects("PRAGMA foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});
