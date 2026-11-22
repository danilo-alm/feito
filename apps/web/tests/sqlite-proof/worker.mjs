import sqlite3InitModule from "./index.mjs";
import { createSqliteStorage, migrateSqlite, queryFiles } from "./storage.mjs";
import { migrations, queries, proofSchema, fixture } from "./sql.mjs";

const statements = Object.fromEntries(Object.entries(queryFiles).map(([name, file]) => [name, queries[file]]));
let libVersion;

const mode = new URL(import.meta.url).searchParams.get("vfs");
const database = sqlite3InitModule().then(async (sqlite) => {
  libVersion = sqlite.version.libVersionNumber;
  let db;
  if (mode === "opfs-sahpool") {
    const pool = await sqlite.installOpfsSAHPoolVfs({
      directory: ".feito-synthetic-sahpool",
      clearOnInit: false,
      preserveOnInitFailure: true,
    });
    db = new pool.OpfsSAHPoolDb("/proof.sqlite3");
  } else {
    if (!crossOriginIsolated || !sqlite.oo1.OpfsDb) {
      throw new Error(`OPFS VFS unavailable (isolated=${crossOriginIsolated}, storage=${!!navigator.storage?.getDirectory}, syncHandle=${!!globalThis.FileSystemFileHandle?.prototype?.createSyncAccessHandle})`);
    }
    db = new sqlite.oo1.OpfsDb("/feito-synthetic-proof.sqlite3");
    db.exec("PRAGMA busy_timeout = 100");
  }
  db.exec("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
  return { db, busy: sqlite.capi.SQLITE_BUSY };
});

async function withBusyRetry(run) {
  const { db, busy } = await database;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(db);
    } catch (error) {
      if (!Number.isInteger(error.resultCode) || (error.resultCode & 0xff) !== busy || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 10));
    }
  }
}

const commands = {
  setupRelational(db) {
    // The schema in this fixture shares a proof file with the small benchmark tables.
    db.transaction("immediate", () => {
      db.exec("DROP TABLE IF EXISTS proof_operations; DROP TABLE IF EXISTS proof_tasks;");
    });
    migrateSqlite(db, libVersion, migrations);
    db.transaction("immediate", () => {
      if (!db.selectValue("SELECT 1 FROM selection")) db.exec(fixture);
    });
    return true;
  },
  importLegacyProfile(db, profile) {
    migrateSqlite(db, libVersion, migrations);
    createSqliteStorage(db, statements).importProfile(profile);
    return true;
  },
  readRelationalQueue(db, selection) {
    return createSqliteStorage(db, statements).readQueue(selection);
  },
  taskDetail(db, { selection, id }) {
    return createSqliteStorage(db, statements).taskDetail(selection, id);
  },
  editTitle(db, { selection, taskId, input }) {
    return createSqliteStorage(db, statements).editTitle(selection, taskId, input);
  },
  readRelationalTask(db, { selection, id }) {
    return createSqliteStorage(db, statements).readTask(selection, id);
  },
  commitRelationalTitle(db, edit) {
    return createSqliteStorage(db, statements).commitTitle(edit);
  },
  setup(db, { size }) {
    db.transaction("immediate", () => {
      if (db.selectValue("SELECT 1 FROM sqlite_schema WHERE name = 'proof_tasks'")) return;
      db.exec(proofSchema);
      db.exec({ sql: `WITH RECURSIVE seq(n) AS (
        SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ?
      ) INSERT INTO proof_tasks SELECT n, n % 100, 'Task ' || n FROM seq`, bind: [size] });
    });
    return {
      sqlite: db.selectValue("SELECT sqlite_version()"),
      journal: db.selectValue("PRAGMA journal_mode"),
      index: db.selectObjects("EXPLAIN QUERY PLAN SELECT * FROM proof_tasks WHERE project_id = 1"),
      size: db.selectValue("PRAGMA page_count") * db.selectValue("PRAGMA page_size"),
    };
  },
  editTask(db, { taskId, title, operationId, rollback }) {
    return db.transaction("immediate", () => {
      if (db.selectValue("SELECT 1 FROM proof_operations WHERE id = ?", [operationId])) return "duplicate";
      db.exec({ sql: "UPDATE proof_tasks SET title = ? WHERE id = ?", bind: [title, taskId] });
      if (db.changes() !== 1) throw new Error("Missing task");
      if (rollback) throw new Error("Forced rollback");
      db.exec({ sql: "INSERT INTO proof_operations (id, task_id, title) VALUES (?, ?, ?)", bind: [operationId, taskId, title] });
      return "committed";
    });
  },
  readProject(db, { projectId }) {
    return db.selectObjects("SELECT id, title FROM proof_tasks WHERE project_id = ? ORDER BY id", [projectId]);
  },
  readQueue(db) {
    return db.selectObjects("SELECT id, task_id, title FROM proof_operations ORDER BY sequence");
  },
};

self.onmessage = async ({ data: { id, command, args } }) => {
  const start = performance.now();
  try {
    const result = await withBusyRetry((db) => commands[command](db, args));
    self.postMessage({ id, result, ms: performance.now() - start });
  } catch (error) {
    self.postMessage({ id, error: error.message, code: error.resultCode });
  }
};
