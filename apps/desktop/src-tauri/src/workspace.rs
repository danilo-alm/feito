use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use chacha20poly1305::{
    aead::{
        rand_core::{OsRng, RngCore},
        Aead, KeyInit, Payload,
    },
    XChaCha20Poly1305, XNonce,
};
#[cfg(test)]
use rusqlite::{params, TransactionBehavior};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use zeroize::Zeroizing;

mod legacy;
mod relational;
mod title;

const STORE_ERROR: &str = "Não foi possível acessar os dados locais.";
const KEY_ERROR: &str = "Não foi possível acessar a chave do Feito no cofre do sistema.";
const DECRYPTION_ERROR: &str = "Não foi possível desbloquear os dados locais do Feito.";
const SAVE_CONFLICT: &str = "Os dados locais mudaram em outra janela. Recarregue e tente de novo.";
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const MAX_GENERATION: i64 = 9_007_199_254_740_991;
const NONCE_BYTES: usize = 24;

type StoreKey = Zeroizing<[u8; 32]>;
type StoreResult<T> = Result<T, &'static str>;

#[derive(Clone)]
pub struct WorkspaceStore {
    directory: PathBuf,
    credential_service: String,
    // The vault key never changes while the app runs. Reading it once per process means a single
    // system prompt per launch, however many reads and writes follow.
    key_cache: Arc<Mutex<Option<StoreKey>>>,
}

#[derive(Serialize)]
pub struct VersionedWorkspace {
    generation: i64,
    value: Value,
}

impl WorkspaceStore {
    pub fn new(directory: PathBuf, credential_service: String) -> Self {
        Self {
            directory,
            credential_service,
            key_cache: Arc::default(),
        }
    }

    fn system_key(&self, can_create: bool) -> StoreResult<StoreKey> {
        let mut cached = self.key_cache.lock().map_err(|_| KEY_ERROR)?;
        if let Some(key) = cached.as_ref() {
            return Ok(key.clone());
        }
        let key = system_key(&self.credential_service, can_create)?;
        *cached = Some(key.clone());
        Ok(key)
    }

    fn create_directory(&self) -> StoreResult<()> {
        let mut directory = fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(&self.directory).map_err(|_| STORE_ERROR)
    }

    #[cfg(test)]
    fn open(&self) -> StoreResult<Connection> {
        self.create_directory()?;
        let database =
            Connection::open(self.directory.join("feito.sqlite3")).map_err(|_| STORE_ERROR)?;
        database
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| STORE_ERROR)?;
        database
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS workspace (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    generation INTEGER NOT NULL CHECK (generation > 0),
                    encrypted BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS session (
                    origin TEXT PRIMARY KEY,
                    encrypted BLOB NOT NULL
                );",
            )
            .map_err(|_| STORE_ERROR)?;
        Ok(database)
    }

    #[cfg(test)]
    fn read(
        &self,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<Option<VersionedWorkspace>> {
        let database = self.open()?;
        let Some((generation, encrypted)) = workspace_record(&database)? else {
            return Ok(None);
        };
        let key = load_key(false)?;
        let plaintext = decrypt(&key, generation, &encrypted)?;
        let value = serde_json::from_slice(&plaintext).map_err(|_| DECRYPTION_ERROR)?;
        Ok(Some(VersionedWorkspace { generation, value }))
    }

    #[cfg(test)]
    fn write(
        &self,
        expected: Option<i64>,
        value: Value,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<VersionedWorkspace> {
        let plaintext = Zeroizing::new(serde_json::to_vec(&value).map_err(|_| STORE_ERROR)?);
        if plaintext.len() > MAX_DOCUMENT_BYTES {
            return Err(
                "O espaço de trabalho excede o limite de armazenamento local desta versão.",
            );
        }

        let mut database = self.open()?;
        let transaction = database
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| STORE_ERROR)?;
        let record = workspace_record(&transaction)?;
        let current = record.as_ref().map(|(generation, _)| *generation);
        if current != expected {
            return Err(SAVE_CONFLICT);
        }
        let generation = current
            .unwrap_or_default()
            .checked_add(1)
            .filter(|generation| *generation <= MAX_GENERATION)
            .ok_or(STORE_ERROR)?;

        // Serialize even the initial key creation across processes with the SQLite write lock.
        let key = load_key(current.is_none())?;
        if let Some((generation, encrypted)) = record {
            // An inaccessible or damaged workspace must remain recoverable.
            decrypt(&key, generation, &encrypted)?;
        }
        let encrypted = seal(&key, &generation.to_be_bytes(), &plaintext)?;
        transaction
            .execute(
                "INSERT INTO workspace (id, generation, encrypted) VALUES (1, ?1, ?2)
                 ON CONFLICT (id) DO UPDATE SET generation = excluded.generation, encrypted = excluded.encrypted",
                params![generation, encrypted],
            )
            .map_err(|_| STORE_ERROR)?;
        transaction.commit().map_err(|_| STORE_ERROR)?;
        Ok(VersionedWorkspace { generation, value })
    }

    /// Reads a server session cookie. Sessions live in the local database, encrypted with the
    /// same system-vault key as the workspace, so the vault is unlocked once for both.
    pub fn read_session(&self, origin: &str) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        self.read_relational_session(origin)
    }

    /// Stores a server session cookie, or removes it when `value` is `None`.
    pub fn write_session(&self, origin: &str, value: Option<&[u8]>) -> StoreResult<()> {
        self.write_relational_session(origin, value)
    }

    #[cfg(test)]
    fn read_session_with(
        &self,
        origin: &str,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        let database = self.open()?;
        let encrypted: Option<Vec<u8>> = database
            .query_row(
                "SELECT encrypted FROM session WHERE origin = ?1",
                params![origin],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| STORE_ERROR)?;
        let Some(encrypted) = encrypted else {
            return Ok(None);
        };
        let key = load_key(false)?;
        open_sealed(&key, &session_aad(origin), &encrypted).map(Some)
    }

    #[cfg(test)]
    fn write_session_with(
        &self,
        origin: &str,
        value: Option<&[u8]>,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<()> {
        let database = self.open()?;
        let Some(value) = value else {
            database
                .execute("DELETE FROM session WHERE origin = ?1", params![origin])
                .map_err(|_| STORE_ERROR)?;
            return Ok(());
        };
        // An existing workspace must never end up with a replacement key: only create one
        // while nothing has been encrypted yet.
        let key = load_key(workspace_record(&database)?.is_none())?;
        let encrypted = seal(&key, &session_aad(origin), value)?;
        database
            .execute(
                "INSERT INTO session (origin, encrypted) VALUES (?1, ?2)
                 ON CONFLICT (origin) DO UPDATE SET encrypted = excluded.encrypted",
                params![origin, encrypted],
            )
            .map_err(|_| STORE_ERROR)?;
        Ok(())
    }
}

fn session_aad(origin: &str) -> Vec<u8> {
    format!("session-v1:{origin}").into_bytes()
}

#[cfg(test)]
fn seal(key: &StoreKey, aad: &[u8], plaintext: &[u8]) -> StoreResult<Vec<u8>> {
    let mut nonce = [0; NONCE_BYTES];
    OsRng.try_fill_bytes(&mut nonce).map_err(|_| STORE_ERROR)?;
    let mut sealed = nonce.to_vec();
    sealed.extend(
        cipher(key)?
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| STORE_ERROR)?,
    );
    Ok(sealed)
}

fn open_sealed(key: &StoreKey, aad: &[u8], sealed: &[u8]) -> StoreResult<Zeroizing<Vec<u8>>> {
    if sealed.len() <= NONCE_BYTES {
        return Err(DECRYPTION_ERROR);
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_BYTES);
    cipher(key)?
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| DECRYPTION_ERROR)
}

fn workspace_record(database: &Connection) -> StoreResult<Option<(i64, Vec<u8>)>> {
    database
        .query_row(
            "SELECT generation, encrypted FROM workspace WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| STORE_ERROR)
}

fn decrypt(key: &StoreKey, generation: i64, encrypted: &[u8]) -> StoreResult<Zeroizing<Vec<u8>>> {
    open_sealed(key, &generation.to_be_bytes(), encrypted)
}

fn cipher(key: &StoreKey) -> StoreResult<XChaCha20Poly1305> {
    XChaCha20Poly1305::new_from_slice(&key[..]).map_err(|_| KEY_ERROR)
}

fn system_key(service: &str, can_create: bool) -> StoreResult<StoreKey> {
    let entry = keyring::Entry::new(service, "workspace-v1").map_err(|_| KEY_ERROR)?;
    let mut key = Zeroizing::new([0; 32]);
    match entry.get_secret() {
        Ok(secret) => {
            let secret = Zeroizing::new(secret);
            if secret.len() != key.len() {
                return Err(KEY_ERROR);
            }
            key.copy_from_slice(&secret);
        }
        Err(keyring::Error::NoEntry) if can_create => {
            OsRng.try_fill_bytes(&mut key[..]).map_err(|_| KEY_ERROR)?;
            entry.set_secret(&key[..]).map_err(|_| KEY_ERROR)?;
        }
        Err(_) => return Err(KEY_ERROR),
    }
    Ok(key)
}

#[tauri::command]
pub async fn read_workspace(
    store: State<'_, WorkspaceStore>,
) -> Result<Option<VersionedWorkspace>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.read_relational(|can_create| store.system_key(can_create))
    })
    .await
    .map_err(|_| STORE_ERROR)?
    .map_err(String::from)
}

#[tauri::command]
pub async fn write_workspace(
    store: State<'_, WorkspaceStore>,
    generation: Option<i64>,
    value: Value,
) -> Result<VersionedWorkspace, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.write_relational(generation, value, |can_create| store.system_key(can_create))
    })
    .await
    .map_err(|_| STORE_ERROR)?
    .map_err(String::from)
}

#[tauri::command]
pub async fn read_workspace_context(
    store: State<'_, WorkspaceStore>,
    selection: Value,
    kind: String,
    id: String,
) -> Result<Option<Value>, String> {
    let store = store.inner().clone();
    let selection: title::Selection = serde_json::from_value(selection).map_err(|_| STORE_ERROR)?;
    let query = match kind.as_str() {
        "task" => include_str!("../../../../packages/core/sqlite/queries/task-context.sql"),
        "project" => {
            include_str!("../../../../packages/core/sqlite/queries/project-context.sql")
        }
        _ => return Err(STORE_ERROR.into()),
    };
    tauri::async_runtime::spawn_blocking(move || -> StoreResult<Option<Value>> {
        let mut db = store.open_relational(|can_create| store.system_key(can_create))?;
        let tx = db.transaction().map_err(|_| STORE_ERROR)?;
        if title::generation(&tx, &selection).map_err(|_| STORE_ERROR)?
            != Some(selection.generation)
        {
            return Err(SAVE_CONFLICT);
        }
        let json: Option<String> = tx
            .query_row(query, [&selection.space_id, "working", &id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| STORE_ERROR)?;
        tx.commit().map_err(|_| STORE_ERROR)?;
        json.map(|json| serde_json::from_str(&json).map_err(|_| STORE_ERROR))
            .transpose()
    })
    .await
    .map_err(|_| STORE_ERROR)?
    .map_err(String::from)
}

#[tauri::command]
pub async fn write_workspace_title(
    store: State<'_, WorkspaceStore>,
    edit: Value,
) -> Result<i64, String> {
    let store = store.inner().clone();
    let edit: title::TitleEdit = serde_json::from_value(edit).map_err(|_| STORE_ERROR)?;
    if edit.title.trim().is_empty() || edit.title.chars().count() > 500 || edit.revision < 1 {
        return Err(STORE_ERROR.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = store.open_relational(|can_create| store.system_key(can_create))?;
        match title::commit_title(&mut db, edit).map_err(|_| STORE_ERROR)? {
            title::Commit::Applied { generation, .. } => Ok(generation),
            _ => Err(SAVE_CONFLICT),
        }
    })
    .await
    .map_err(|_| STORE_ERROR)?
    .map_err(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_key(_: bool) -> StoreResult<StoreKey> {
        Ok(Zeroizing::new([7; 32]))
    }

    #[test]
    fn saves_workspace_and_queue_atomically_across_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().to_path_buf();
        let store = WorkspaceStore::new(path.clone(), "app.feito.desktop.test".into());
        assert!(store
            .read(|_| panic!("empty workspace should not load a key"))
            .unwrap()
            .is_none());

        let first = json!({ "title": "Conteúdo privado", "pending": ["task-1"] });
        let saved = store
            .write(None, first.clone(), |can_create| {
                assert!(can_create);
                test_key(can_create)
            })
            .unwrap();
        assert_eq!(saved.generation, 1);

        let reopened = WorkspaceStore::new(path.clone(), "app.feito.desktop.test".into());
        let durable = reopened.read(test_key).unwrap().unwrap();
        assert_eq!(durable.value, first);
        assert_eq!(durable.generation, 1);
        assert!(!fs::read(path.join("feito.sqlite3"))
            .unwrap()
            .windows("Conteúdo privado".len())
            .any(|bytes| bytes == "Conteúdo privado".as_bytes()));

        assert_eq!(
            reopened.write(None, Value::Null, test_key).err(),
            Some(SAVE_CONFLICT)
        );
        let next = json!({ "title": "Conteúdo privado", "pending": [] });
        let saved = reopened.write(Some(1), next.clone(), test_key).unwrap();
        assert_eq!(saved.generation, 2);
        assert_eq!(reopened.read(test_key).unwrap().unwrap().value, next);
    }

    #[test]
    fn existing_data_requires_the_original_key_and_detects_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().to_path_buf(), "app.feito.desktop.test".into());
        store
            .write(None, json!({ "secret": true }), test_key)
            .unwrap();
        assert_eq!(
            store
                .read(|can_create| {
                    assert!(!can_create);
                    Err(KEY_ERROR)
                })
                .err(),
            Some(KEY_ERROR)
        );
        assert_eq!(
            store.read(|_| Ok(Zeroizing::new([8; 32]))).err(),
            Some(DECRYPTION_ERROR)
        );
        store
            .open()
            .unwrap()
            .execute("UPDATE workspace SET generation = 2", [])
            .unwrap();
        assert_eq!(store.read(test_key).err(), Some(DECRYPTION_ERROR));
        assert_eq!(
            store.write(Some(2), Value::Null, test_key).err(),
            Some(DECRYPTION_ERROR)
        );
    }

    #[test]
    fn sessions_are_encrypted_bound_to_their_origin_and_share_the_workspace_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().to_path_buf(), "app.feito.desktop.test".into());
        let origin = "https://feito.example.com";
        assert!(store
            .read_session_with(origin, |_| panic!("no session should not load a key"))
            .unwrap()
            .is_none());

        store
            .write_session_with(origin, Some(b"cookie-value"), |can_create| {
                assert!(can_create);
                test_key(can_create)
            })
            .unwrap();
        let stored = store.read_session_with(origin, test_key).unwrap().unwrap();
        assert_eq!(&stored[..], b"cookie-value");
        assert!(!fs::read(dir.path().join("feito.sqlite3"))
            .unwrap()
            .windows("cookie-value".len())
            .any(|bytes| bytes == "cookie-value".as_bytes()));

        // A session is only valid for the origin it was stored for.
        let other = "https://other.example.com";
        store
            .open()
            .unwrap()
            .execute(
                "UPDATE session SET origin = ?1 WHERE origin = ?2",
                params![other, origin],
            )
            .unwrap();
        assert_eq!(
            store.read_session_with(other, test_key).err(),
            Some(DECRYPTION_ERROR)
        );

        store.write_session_with(other, None, test_key).unwrap();
        assert!(store
            .read_session_with(other, |_| panic!("removed session should not load a key"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn sessions_never_create_a_replacement_key_for_an_existing_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(dir.path().to_path_buf(), "app.feito.desktop.test".into());
        store.write(None, json!({}), test_key).unwrap();
        store
            .write_session_with("https://feito.example.com", Some(b"abc"), |can_create| {
                assert!(!can_create);
                test_key(can_create)
            })
            .unwrap();
    }

    #[test]
    fn caches_the_system_key_after_the_first_load() {
        let store = WorkspaceStore::new(
            PathBuf::from("unused"),
            "app.feito.desktop.test.cache".into(),
        );
        *store.key_cache.lock().unwrap() = Some(Zeroizing::new([9; 32]));
        // Would fail against a real vault; the cached key is returned instead.
        assert_eq!(&store.system_key(false).unwrap()[..], &[9; 32]);
        assert_eq!(&store.clone().system_key(false).unwrap()[..], &[9; 32]);
    }
}

#[cfg(all(test, feature = "sqlite-proof"))]
#[path = "../tests/support/cipher.rs"]
mod proof_cipher;

#[cfg(all(test, feature = "sqlite-proof"))]
#[test]
fn converts_an_authenticated_legacy_file_in_a_separate_encrypted_destination() {
    use serde_json::json;

    const INITIAL: &str =
        include_str!("../../../../packages/core/sqlite/migrations/001-initial.sql");
    const IMPORT: &str =
        include_str!("../../../../packages/core/sqlite/migrations/002-import-layer.sql");
    const IMPORT_PROFILE: &str =
        include_str!("../../../../packages/core/sqlite/queries/import-profile.sql");
    let directory = tempfile::tempdir().unwrap();
    let store = WorkspaceStore::new(
        directory.path().to_path_buf(),
        "app.feito.desktop.test".into(),
    );
    let workspace = json!({
        "preferences": { "theme": "dark", "timezone": "America/Maceio", "locale": "pt-BR" },
        "projects": [{
            "id": "inbox", "revision": 7, "isInbox": true,
            "data": { "name": "Inbox", "archived": false, "view": { "layout": "list", "sortMode": "manual", "showCompleted": false } }
        }],
        "sections": [], "tasks": [], "labels": [], "taskLabels": [], "occurrences": [],
    });
    let linked = |origin, id, queue_id| {
        json!({
            "origin": origin, "user": { "id": id, "email": "synthetic@example.invalid" },
            "confirmed": workspace, "working": workspace, "cursor": 400,
            "pending": [{ "id": queue_id, "method": "POST", "path": "/tasks", "authoredAt": "2026-11-22T12:00:00Z",
                "body": { "title": "Queued task" }, "generatedIds": ["preserved-task-id"] }],
        })
    };
    let document = json!({
        "version": 1, "active": "local", "local": workspace,
        "server": linked("https://current.invalid", "current", "queued-current"),
        "previousServers": [
            linked("https://previous.invalid", "previous", "queued-previous"),
            linked("https://oldest.invalid", "oldest", "queued-oldest"),
        ],
    });

    let key = |_| Ok(Zeroizing::new([7; 32]));
    store.write(None, document.clone(), key).unwrap();
    let source = directory.path().join("feito.sqlite3");
    let before = fs::read(&source).unwrap();
    assert_eq!(store.read(|_| Err(KEY_ERROR)).err(), Some(KEY_ERROR));
    assert_eq!(
        store.read(|_| Ok(Zeroizing::new([8; 32]))).err(),
        Some(DECRYPTION_ERROR)
    );

    let legacy = store.read(key).unwrap().unwrap();
    let profile = legacy::profile(legacy.value, legacy.generation).unwrap();
    let destination = directory.path().join("relational.sqlite3");
    let mut db = proof_cipher::open(&destination, &[9; 32]).unwrap();
    let tx = db.transaction().unwrap();
    tx.execute_batch(INITIAL).unwrap();
    tx.execute_batch(IMPORT).unwrap();
    tx.pragma_update(None, "user_version", 2).unwrap();
    tx.commit().unwrap();
    {
        let tx = db.transaction().unwrap();
        tx.execute(IMPORT_PROFILE, [profile.to_string()]).unwrap();
        // Dropping the transaction simulates interruption before SQLite commits.
    }
    drop(db);
    let mut db = proof_cipher::open(&destination, &[9; 32]).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM spaces", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let tx = db.transaction().unwrap();
    tx.execute(IMPORT_PROFILE, [profile.to_string()]).unwrap();
    tx.commit().unwrap();
    drop(db);

    let db = proof_cipher::open(&destination, &[9; 32]).unwrap();
    let operations = db.prepare(
        "SELECT pending_operations.id FROM pending_operations JOIN spaces ON pending_operations.space_id = spaces.id
         ORDER BY server_order, sequence",
    ).unwrap().query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    assert_eq!(
        operations,
        ["queued-current", "queued-previous", "queued-oldest"]
    );
    let selection: (String, String, i64) = db
        .query_row(
            "SELECT space_id, current_server_id, generation FROM selection",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        selection,
        (
            "inbox".into(),
            "remote:https://current.invalid:current".into(),
            1
        )
    );
    assert_eq!(
        db.query_row(
            "SELECT revision FROM projects WHERE space_id = 'inbox'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        7
    );
    assert_eq!(fs::read(source).unwrap(), before);
    assert_eq!(store.read(key).unwrap().unwrap().value, document);
}
