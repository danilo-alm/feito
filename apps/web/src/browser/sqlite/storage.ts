import type { Database } from "@sqlite.org/sqlite-wasm";
import { handleLocal, type Workspace } from "@feito/core/product/local-executor";
import { operationFor } from "@feito/core/product/replica";
import type { SQLiteCommit, SQLiteProfile, SQLiteSelection, SQLiteTitleEdit } from "@feito/core/product/sqlite-batches";

export const queryFiles = {
  task: "task.sql",
  taskContext: "task-context.sql",
  projectContext: "project-context.sql",
  projectTasks: "project-tasks.sql",
  children: "children.sql",
  selection: "check-selection.sql",
  updateTitle: "update-task-title.sql",
  appendOperation: "append-operation.sql",
  advanceSequence: "advance-sequence.sql",
  advanceGeneration: "advance-generation.sql",
  pendingOperation: "pending-operation.sql",
  queue: "queue.sql",
  importProfile: "import-profile.sql",
} as const;

type Queries = Record<keyof typeof queryFiles, string>;

const minimum = 3_038_000;

export function migrateSqlite(db: Database, versionNumber: number, migrations: readonly string[]) {
  if (versionNumber < minimum) throw new Error("SQLite 3.38 or later is required");
  db.exec("PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;");
  db.transaction("IMMEDIATE", () => {
    const version = db.selectValue("PRAGMA user_version");
    if (typeof version !== "number" || version < 0 || version > migrations.length
      || (version === 0 && db.selectValue("SELECT 1 FROM sqlite_schema LIMIT 1") !== undefined)) {
      throw new Error("Unsupported SQLite workspace schema");
    }
    if (version === migrations.length) return;
    for (const script of migrations.slice(version)) db.exec(script);
    db.exec("PRAGMA user_version = " + migrations.length);
  });
}

export function createSqliteStorage(db: Database, sql: Queries) {
  function generation({ spaceId, epoch }: SQLiteSelection) {
    return db.selectValue(sql.selection, [spaceId, epoch]);
  }

  function scoped(selection: SQLiteSelection, query: string, id: string) {
    return db.transaction("DEFERRED", () => {
      if (generation(selection) !== selection.generation) return undefined;
      return db.selectObjects(query, [selection.spaceId, "working", id]);
    });
  }

  function workspaceContext(selection: SQLiteSelection, query: string, id: string) {
    return db.transaction("DEFERRED", () => {
      if (generation(selection) !== selection.generation) return undefined;
      const json = db.selectValue(query, [selection.spaceId, "working", id]);
      return {
        workspace: typeof json === "string" ? JSON.parse(json) as Workspace : undefined,
        remote: db.selectValue("SELECT kind FROM spaces WHERE id = ?", [selection.spaceId]) === "remote",
      };
    });
  }

  const storage = {
    importProfile(profile: SQLiteProfile) {
      db.transaction("IMMEDIATE", () => {
        db.exec({ sql: sql.importProfile, bind: [JSON.stringify(profile)] });
      });
    },
    readTask: (selection: SQLiteSelection, id: string) => scoped(selection, sql.task, id)?.[0],
    readProjectTasks: (selection: SQLiteSelection, id: string) => scoped(selection, sql.projectTasks, id),
    readQueue(selection: SQLiteSelection) {
      return db.transaction("DEFERRED", () => {
        if (generation(selection) !== selection.generation) return undefined;
        return db.selectObjects(sql.queue, [selection.spaceId]);
      });
    },

    async taskDetail(selection: SQLiteSelection, id: string) {
      const scope = workspaceContext(selection, sql.taskContext, id);
      if (!scope) return "conflict";
      if (!scope.workspace) return null;
      const result = await handleLocal(scope.workspace, { path: "/tasks/" + id, method: "GET" });
      return { status: result.status, body: result.body };
    },

    async projectDetail(selection: SQLiteSelection, id: string, path: string) {
      const scope = workspaceContext(selection, sql.projectContext, id);
      if (!scope) return "conflict";
      if (!scope.workspace) return null;
      const result = await handleLocal(scope.workspace, { path, method: "GET" });
      return { status: result.status, body: result.body };
    },

    async editTitle(selection: SQLiteSelection, taskId: string, input: {
      id: string;
      authoredAt: string;
      taskChanges?: boolean;
      body: { revision: number; title: string };
    }) {
      if (Object.keys(input.body).some((field) => field !== "revision" && field !== "title")) {
        return { status: 400, body: { error: { code: "VALIDATION_ERROR", message: "Only title edits are supported" } } };
      }
      const scope = workspaceContext(selection, sql.taskContext, taskId);
      if (!scope) return "conflict";
      if (!scope.workspace) return null;
      const request = {
        ...input, path: "/tasks/" + taskId, method: "PATCH", revision: selection.generation,
        body: { revision: input.body.revision, title: input.body.title },
      };
      const result = await handleLocal(scope.workspace, request);
      if (result.status < 400) {
        const task = result.workspace.tasks.find((candidate) => candidate.id === taskId);
        if (!task) return "conflict";
        const commit = storage.commitTitle({
          selection, taskId, revision: input.body.revision, title: task.data.title,
          operation: scope.remote ? operationFor(request, result) : undefined,
        });
        if (typeof commit === "string") return commit;
      }
      return { status: result.status, body: result.body };
    },

    commitTitle({ selection, taskId, revision, title, operation }: SQLiteTitleEdit): SQLiteCommit {
      const { spaceId, epoch } = selection;
      return db.transaction("IMMEDIATE", (): SQLiteCommit => {
        const current = generation(selection);
        if (current === undefined) return "conflict";
        const body = operation?.body === undefined ? null : JSON.stringify(operation.body);
        const generatedIds = operation?.generatedIds === undefined ? null : JSON.stringify(operation.generatedIds);
        if (operation) {
          const existing = db.selectObject(sql.pendingOperation, [spaceId, operation.id]);
          if (existing) {
            if (existing.path !== operation.path || existing.method !== operation.method
              || existing.authored_at !== operation.authoredAt || existing.body !== body
              || existing.generated_ids !== generatedIds) {
              throw new Error("Operation ID reused for a different edit");
            }
            return "duplicate";
          }
        }

        if (current !== selection.generation) return "conflict";
        const remote = db.selectValue("SELECT kind FROM spaces WHERE id = ?", [spaceId]) === "remote";
        if (remote !== !!operation) throw new Error("Invalid operation for the selected workspace");
        const nextRevision = db.selectValue(sql.updateTitle, [spaceId, taskId, revision, title]);
        if (typeof nextRevision !== "number") return "conflict";
        if (operation) {
          db.exec({ sql: sql.appendOperation, bind: [
            spaceId, operation.id, operation.method, operation.path, operation.authoredAt, body, generatedIds,
          ] });
          if (db.changes() !== 1) throw new Error("Replica has no queue");
          db.exec({ sql: sql.advanceSequence, bind: [spaceId] });
        }
        const nextGeneration = db.selectValue(sql.advanceGeneration, [spaceId, epoch, selection.generation]);
        if (typeof nextGeneration !== "number") throw new Error("Invalid workspace generation");
        return { generation: nextGeneration, revision: nextRevision };
      });
    },
  };
  return storage;
}
