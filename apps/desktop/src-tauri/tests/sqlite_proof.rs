#![cfg(feature = "sqlite-proof")]

use rusqlite::{params, Connection, TransactionBehavior};
use std::{fs, path::Path, time::Instant};

#[path = "support/cipher.rs"]
mod cipher;

use cipher::open;

const SCHEMA: &str = include_str!("../../../../scripts/sqlite-proof/schema.sql");
const PROJECT: &str = "SELECT id, title FROM proof_tasks WHERE project_id = ?1 ORDER BY id";
const TITLE: &str = "Synthetic title that must be encrypted by SQLCipher";

fn edit(db: &mut Connection, id: &str, title: &str, rollback: bool) -> rusqlite::Result<bool> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let duplicate: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM proof_operations WHERE id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if duplicate {
        return Ok(false);
    }
    assert_eq!(
        tx.execute("UPDATE proof_tasks SET title = ?1 WHERE id = 1", [title])?,
        1
    );
    if rollback {
        return Ok(false);
    }
    tx.execute(
        "INSERT INTO proof_operations (id, task_id, title) VALUES (?1, 1, ?2)",
        params![id, title],
    )?;
    tx.commit()?;
    Ok(true)
}

fn read_project(db: &Connection) -> Vec<String> {
    db.prepare(PROJECT)
        .unwrap()
        .query_map([1], |row| row.get(1))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn assert_encrypted(path: &Path) -> Vec<u8> {
    let bytes = fs::read(path).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    for marker in [TITLE, "proof_tasks"] {
        assert!(!bytes
            .windows(marker.len())
            .any(|part| part == marker.as_bytes()));
    }
    bytes
}

#[test]
fn indexed_read_and_atomic_edit_survive_encrypted_restart() {
    for size in [10_000, 100_000] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("synthetic.sqlite3");
        let start = Instant::now();
        let mut db = open(&path, &[0x8a; 32]).unwrap();
        let sqlite = rusqlite::version();
        let cipher: String = db
            .pragma_query_value(None, "cipher_version", |row| row.get(0))
            .unwrap();
        let journal: String = db
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(journal, "delete");
        let tx = db.transaction().unwrap();
        tx.execute_batch(SCHEMA).unwrap();
        tx.execute(
            "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ?1)
             INSERT INTO proof_tasks SELECT n, n % 100, 'Task ' || n FROM seq",
            [size],
        )
        .unwrap();
        tx.commit().unwrap();
        let seed = start.elapsed();

        let plan: String = db
            .query_row(&format!("EXPLAIN QUERY PLAN {PROJECT}"), [1], |row| {
                row.get(3)
            })
            .unwrap();
        assert!(plan.contains("proof_tasks_by_project"));
        assert!(!edit(&mut db, "stable", "Rolled back", true).unwrap());
        assert_eq!(read_project(&db)[0], "Task 1");
        let count: i64 = db
            .query_row("SELECT count(*) FROM proof_operations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);

        let start = Instant::now();
        assert!(edit(&mut db, "stable", TITLE, false).unwrap());
        let edit_time = start.elapsed();
        drop(db);
        let bytes = assert_encrypted(&path);
        {
            let mut reopened = open(&path, &[0x8a; 32]).unwrap();
            let tx = reopened.transaction().unwrap();
            tx.execute(
                "UPDATE proof_tasks SET title = 'Altered in a transaction' WHERE id = 1",
                [],
            )
            .unwrap();
            assert_encrypted(&directory.path().join("synthetic.sqlite3-journal"));
            tx.rollback().unwrap();
        }
        let start = Instant::now();
        let mut reopened = open(&path, &[0x8a; 32]).unwrap();
        assert_eq!(read_project(&reopened)[0], TITLE);
        let reopen = start.elapsed();
        let start = Instant::now();
        assert_eq!(read_project(&reopened).len(), size as usize / 100);
        let warm = start.elapsed();
        assert!(!edit(&mut reopened, "stable", "Do not replay", false).unwrap());
        let stored: String = reopened
            .query_row("SELECT title FROM proof_operations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, TITLE);
        drop(reopened);
        assert!(open(&path, &[0x7b; 32]).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);

        let damaged_path = directory.path().join("damaged.sqlite3");
        let mut damaged = bytes;
        damaged[100] ^= 1;
        fs::write(&damaged_path, &damaged).unwrap();
        assert!(open(&damaged_path, &[0x8a; 32]).is_err());
        assert_eq!(fs::read(&damaged_path).unwrap(), damaged);
        println!("SQLite {sqlite}, SQLCipher {cipher}, {journal}, tasks={size}, bytes={}, seed={seed:?}, edit={edit_time:?}, reopen={reopen:?}, warm={warm:?}, plan={plan}", damaged.len());
    }
}

#[path = "support/relational.rs"]
mod relational;

const RELATIONAL_FIXTURE: &str =
    include_str!("../../../../scripts/sqlite-proof/relational-fixture.sql");

#[tauri::command]
fn proof_project(
    database: tauri::State<'_, std::sync::Mutex<Connection>>,
    selection: relational::Selection,
    project_id: String,
) -> Result<Option<Vec<relational::Task>>, &'static str> {
    let mut db = database.lock().map_err(|_| "Could not open workspace")?;
    relational::read_project(&mut db, selection, &project_id).map_err(|_| "Could not read project")
}

#[tauri::command]
fn proof_task_context(
    database: tauri::State<'_, std::sync::Mutex<Connection>>,
    selection: relational::Selection,
    task_id: String,
) -> Result<Option<serde_json::Value>, &'static str> {
    let mut db = database.lock().map_err(|_| "Could not open workspace")?;
    let json = relational::read_task_context(&mut db, selection, &task_id)
        .map_err(|_| "Could not read task context")?;
    json.map(|text| serde_json::from_str(&text).map_err(|_| "Invalid task context"))
        .transpose()
}

#[tauri::command]
fn proof_edit(
    database: tauri::State<'_, std::sync::Mutex<Connection>>,
    edit: relational::TitleEdit,
) -> Result<relational::Commit, &'static str> {
    let mut db = database.lock().map_err(|_| "Could not open workspace")?;
    relational::commit_title(&mut db, edit).map_err(|_| "Could not commit edit")
}

#[test]
fn relational_schema_edit_and_indexed_project_read_via_tauri_ipc() {
    use serde_json::json;
    use tauri::{test, Manager};

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("relational.sqlite3");
    let mut db = open(&path, &[0xc2; 32]).unwrap();
    relational::migrate(&mut db).unwrap();
    db.execute_batch(RELATIONAL_FIXTURE).unwrap();
    let query = include_str!("../../../../packages/core/sqlite/queries/project-tasks.sql");
    let plan: String = db
        .query_row(
            &format!("EXPLAIN QUERY PLAN {query}"),
            ["remote", "working", "project"],
            |row| row.get(3),
        )
        .unwrap();
    assert!(plan.contains("tasks_by_project"), "{plan}");

    let app = test::mock_builder()
        .manage(std::sync::Mutex::new(db))
        .invoke_handler(tauri::generate_handler![
            proof_project,
            proof_task_context,
            proof_edit
        ])
        .build(test::mock_context(test::noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, body| {
        test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: test::INVOKE_KEY.to_string(),
            },
        )
        .map(|body| body.deserialize::<serde_json::Value>().unwrap())
    };

    let selection = json!({ "spaceId": "remote", "epoch": "epoch", "generation": 12 });
    let edit = json!({
        "selection": selection,
        "taskId": "task", "revision": 1, "title": TITLE,
        "operation": {
            "id": "op", "method": "PATCH", "path": "/tasks/task", "authoredAt": "2026-11-22T00:00:00Z",
            "body": { "title": TITLE, "revision": 1 }
        }
    });
    assert_eq!(
        invoke(
            "proof_project",
            json!({ "selection": selection, "projectId": "project" })
        )
        .unwrap(),
        json!([{ "id": "task", "title": "Original task", "revision": 1 }])
    );

    let context = invoke(
        "proof_task_context",
        json!({ "selection": selection, "taskId": "task" }),
    )
    .unwrap();
    assert_eq!(context["tasks"][0]["id"], "task");
    assert_eq!(context["tasks"][0]["data"]["title"], "Original task");
    assert_eq!(context["labels"][0]["id"], "label");
    assert_eq!(context["taskLabels"], json!([["task", ["label"]]]));

    let state = app.state::<std::sync::Mutex<Connection>>();
    state.lock().unwrap().execute_batch(
        "CREATE TEMP TRIGGER fail_queue BEFORE INSERT ON pending_operations BEGIN SELECT RAISE(ABORT, 'forced'); END;"
    ).unwrap();
    assert_eq!(
        invoke("proof_edit", json!({ "edit": edit })),
        Err(json!("Could not commit edit"))
    );
    {
        let db = state.lock().unwrap();
        let title: String = db
            .query_row(
                "SELECT title FROM tasks WHERE space_id = 'remote' AND layer = 'working'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM pending_operations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "Original task");
        assert_eq!(count, 0);
        db.execute_batch("DROP TRIGGER fail_queue").unwrap();
    }
    assert_eq!(
        invoke("proof_edit", json!({ "edit": edit })).unwrap(),
        json!({ "generation": 13, "revision": 2 })
    );
    assert_eq!(
        invoke("proof_edit", json!({ "edit": edit })).unwrap(),
        json!("duplicate")
    );
    assert_eq!(
        invoke(
            "proof_project",
            json!({ "selection": selection, "projectId": "project" })
        )
        .unwrap(),
        json!(null)
    );

    drop(window);
    drop(app);
    assert_encrypted(&path);
    let mut reopened = open(&path, &[0xc2; 32]).unwrap();
    relational::migrate(&mut reopened).unwrap();
    let working_and_confirmed: Vec<String> = reopened
        .prepare("SELECT title FROM tasks ORDER BY space_id, layer")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        working_and_confirmed,
        ["Original task", "Original task", TITLE]
    );
    let operations: i64 = reopened
        .query_row(
            "SELECT count(*) FROM pending_operations WHERE id = 'op'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(operations, 1);
}
