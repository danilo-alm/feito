use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! query {
    ($name:literal) => {
        include_str!(concat!(
            "../../../../../packages/core/sqlite/queries/",
            $name,
            ".sql"
        ))
    };
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub space_id: String,
    pub epoch: String,
    pub generation: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    id: String,
    method: String,
    path: String,
    authored_at: String,
    body: Option<Value>,
    generated_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleEdit {
    pub selection: Selection,
    pub task_id: String,
    pub revision: i64,
    pub title: String,
    pub operation: Option<Operation>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Commit {
    Applied { generation: i64, revision: i64 },
    Conflict(&'static str),
    Duplicate(&'static str),
}

pub fn generation(db: &Connection, selection: &Selection) -> rusqlite::Result<Option<i64>> {
    db.query_row(
        query!("check-selection"),
        params![selection.space_id, selection.epoch],
        |row| row.get(0),
    )
    .optional()
}

pub fn commit_title(db: &mut Connection, edit: TitleEdit) -> rusqlite::Result<Commit> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let selection = edit.selection;
    let Some(current) = generation(&tx, &selection)? else {
        return Ok(Commit::Conflict("conflict"));
    };
    let space = &selection.space_id;
    let operation = edit.operation.map(|operation| {
        let body = operation.body.as_ref().map(Value::to_string);
        let generated_ids = operation.generated_ids.as_ref().map(|ids| {
            // This value contains only generated IDs and can always be serialized.
            serde_json::json!(ids).to_string()
        });
        (operation, body, generated_ids)
    });
    if let Some((operation, body, generated_ids)) = &operation {
        let duplicate = tx
            .query_row(
                query!("pending-operation"),
                params![space, operation.id],
                |row| {
                    let existing_body: Option<String> = row.get("body")?;
                    let existing_ids: Option<String> = row.get("generated_ids")?;
                    let existing_body = existing_body.as_deref().map(serde_json::from_str::<Value>);
                    Ok(row.get::<_, String>("path")? == operation.path
                        && row.get::<_, String>("method")? == operation.method
                        && row.get::<_, String>("authored_at")? == operation.authored_at
                        && existing_body.as_ref().and_then(|body| body.as_ref().ok())
                            == operation.body.as_ref()
                        && existing_ids == *generated_ids
                        && (body.is_none() || existing_body.is_some()))
                },
            )
            .optional()?;
        if let Some(same) = duplicate {
            return if same {
                Ok(Commit::Duplicate("duplicate"))
            } else {
                Err(rusqlite::Error::InvalidQuery)
            };
        }
    }
    if current != selection.generation {
        return Ok(Commit::Conflict("conflict"));
    }
    let remote: bool = tx.query_row(
        "SELECT kind = 'remote' FROM spaces WHERE id = ?1",
        [space],
        |row| row.get(0),
    )?;
    if remote != operation.is_some() {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let revision = tx
        .query_row(
            query!("update-task-title"),
            params![space, edit.task_id, edit.revision, edit.title],
            |row| row.get(0),
        )
        .optional()?;
    let Some(revision) = revision else {
        return Ok(Commit::Conflict("conflict"));
    };
    if let Some((operation, body, generated_ids)) = operation {
        let inserted = tx.execute(
            query!("append-operation"),
            params![
                space,
                operation.id,
                operation.method,
                operation.path,
                operation.authored_at,
                body,
                generated_ids
            ],
        )?;
        if inserted != 1 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        tx.execute(query!("advance-sequence"), [space])?;
    }
    let generation = tx.query_row(
        query!("advance-generation"),
        params![space, selection.epoch, selection.generation],
        |row| row.get(0),
    )?;
    tx.commit()?;
    Ok(Commit::Applied {
        generation,
        revision,
    })
}
