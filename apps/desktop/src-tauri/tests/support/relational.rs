use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::Serialize;

#[path = "../../src/workspace/title.rs"]
mod title;
use title::generation;
pub use title::{commit_title, Commit, Selection, TitleEdit};

const MIGRATIONS: [&str; 2] = [
    include_str!("../../../../../packages/core/sqlite/migrations/001-initial.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/002-import-layer.sql"),
];
macro_rules! query {
    ($name:literal) => {
        include_str!(concat!(
            "../../../../../packages/core/sqlite/queries/",
            $name,
            ".sql"
        ))
    };
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Task {
    id: String,
    title: String,
    revision: i64,
}

fn task_row(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        revision: row.get("revision")?,
    })
}

pub fn migrate(db: &mut Connection) -> rusqlite::Result<()> {
    if rusqlite::version_number() < 3_038_000 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY;")?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let version = usize::try_from(version).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let pending = MIGRATIONS
        .get(version..)
        .ok_or(rusqlite::Error::InvalidQuery)?;
    if version == 0 {
        let empty: bool = tx.query_row("SELECT count(*) = 0 FROM sqlite_schema", [], |row| {
            row.get(0)
        })?;
        if !empty {
            return Err(rusqlite::Error::InvalidQuery);
        }
    }
    for script in pending {
        tx.execute_batch(script)?;
    }
    if !pending.is_empty() {
        tx.pragma_update(None, "user_version", MIGRATIONS.len())?;
    }
    tx.commit()
}

pub fn read_project(
    db: &mut Connection,
    selection: Selection,
    id: &str,
) -> rusqlite::Result<Option<Vec<Task>>> {
    let tx = db.transaction()?;
    if generation(&tx, &selection)? != Some(selection.generation) {
        return Ok(None);
    }
    let rows = tx
        .prepare(query!("project-tasks"))?
        .query_map(params![selection.space_id, "working", id], task_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    tx.commit()?;
    Ok(Some(rows))
}

pub fn read_task_context(
    db: &mut Connection,
    selection: Selection,
    id: &str,
) -> rusqlite::Result<Option<String>> {
    let tx = db.transaction()?;
    if generation(&tx, &selection)? != Some(selection.generation) {
        return Ok(None);
    }
    let json = tx
        .query_row(
            query!("task-context"),
            params![selection.space_id, "working", id],
            |row| row.get(0),
        )
        .optional()?;
    tx.commit()?;
    Ok(json)
}
