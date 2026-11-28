use super::*;
use hkdf::Hkdf;
use rusqlite::{params, ErrorCode, TransactionBehavior};
use serde_json::json;
use sha2::Sha256;
use std::{
    fmt::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const MIGRATIONS: &[&str] = &[
    include_str!("../../../../../packages/core/sqlite/migrations/001-initial.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/002-import-layer.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/003-save-profile.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/004-read-profile.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/005-manual-order.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/006-agenda-layouts.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/007-parent-projects.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/008-task-comments.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/009-appearance.sql"),
    include_str!("../../../../../packages/core/sqlite/migrations/010-accent-colors.sql"),
];
const LEGACY_DATABASE: &str = "feito.sqlite3";
const DATABASE: &str = "feito-relational.sqlite3";
const RECOVERY_DIRECTORY: &str = "recovery";
const READ_PROFILE: &str =
    include_str!("../../../../../packages/core/sqlite/queries/read-profile.sql");
const SAVE_PROFILE: &str =
    include_str!("../../../../../packages/core/sqlite/queries/save-profile.sql");
const IMPORT_PROFILE: &str =
    include_str!("../../../../../packages/core/sqlite/queries/import-profile.sql");

fn connect(path: &Path, root: &StoreKey) -> StoreResult<Connection> {
    let mut key = Zeroizing::new([0; 32]);
    Hkdf::<Sha256>::new(None, &root[..])
        .expand(b"Feito/SQLCipher/workspaces/v1", &mut key[..])
        .map_err(|_| KEY_ERROR)?;
    let mut literal = Zeroizing::new(String::with_capacity(67));
    literal.push_str("x'");
    for byte in key.iter() {
        write!(&mut *literal, "{byte:02x}").map_err(|_| KEY_ERROR)?;
    }
    literal.push('\'');
    let db = Connection::open(path).map_err(|_| STORE_ERROR)?;
    // SQLCipher consumes the byte slice during the call. The key never becomes part of SQL text.
    let result = unsafe {
        rusqlite::ffi::sqlite3_key(db.handle(), literal.as_ptr().cast(), literal.len() as i32)
    };
    if result != rusqlite::ffi::SQLITE_OK {
        return Err(KEY_ERROR);
    }
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|_| STORE_ERROR)?;
    db.query_row("SELECT count(*) FROM sqlite_schema", [], |_| Ok(()))
        .map_err(|error| match error.sqlite_error_code() {
            // Only a wrong key or a damaged file. A busy or failing disk is not a lost workspace.
            Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt) => DECRYPTION_ERROR,
            _ => STORE_ERROR,
        })?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;
         PRAGMA temp_store = MEMORY; PRAGMA synchronous = FULL;",
    )
    .map_err(|_| STORE_ERROR)?;
    Ok(db)
}

fn has_legacy_sessions(db: &Connection) -> StoreResult<bool> {
    db.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'session')",
        [],
        |row| row.get(0),
    )
    .map_err(|_| STORE_ERROR)
}

fn document(profile: Value) -> Option<VersionedWorkspace> {
    let selection = profile.get("selection")?;
    let generation = selection["generation"].as_i64()?;
    let selected = selection["spaceId"].as_str();
    let current = selection["currentServerId"].as_str();
    let local = profile.get("local").filter(|value| value.is_object());
    let active = if selected.is_none() {
        "none"
    } else if selected == current {
        "server"
    } else if selected == local.and_then(|value| value["id"].as_str()) {
        "local"
    } else {
        return None;
    };
    let mut value = json!({"version": 1, "active": active});
    if let Some(local) = local {
        value["local"] = local.get("workspace")?.clone();
    }
    let mut previous = Vec::new();
    for remote in profile["remotes"].as_array()? {
        let mut remote = remote.as_object()?.clone();
        let id = remote.remove("id")?;
        if remote.get("notice").is_some_and(Value::is_null) {
            remote.remove("notice");
        }
        if id.as_str() == current {
            value["server"] = Value::Object(remote);
        } else {
            previous.push(Value::Object(remote));
        }
    }
    if !previous.is_empty() {
        value["previousServers"] = json!(previous);
    }
    Some(VersionedWorkspace { generation, value })
}

impl WorkspaceStore {
    /// Serializes key creation, conversion and recovery across app processes.
    fn lock_initialization(&self) -> StoreResult<fs::File> {
        self.create_directory()?;
        let initialization = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.directory.join("feito-relational.lock"))
            .map_err(|_| STORE_ERROR)?;
        initialization.lock().map_err(|_| STORE_ERROR)?;
        Ok(initialization)
    }

    pub(super) fn open_relational(
        &self,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<Connection> {
        let _initialization = self.lock_initialization()?;
        self.open_locked(load_key)
    }

    /// Moves the databases into a recovery folder, only when the key is gone or cannot open them.
    /// Nothing is deleted: restoring the key and the files brings the workspace back.
    pub(super) fn archive_unreadable(
        &self,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<()> {
        let _initialization = self.lock_initialization()?;
        match self.open_locked(load_key) {
            // The data opens again, for instance after the key was restored. Keep it in place.
            Ok(_) => Ok(()),
            Err(KEY_MISSING_ERROR | DEV_KEY_MISSING_ERROR | DECRYPTION_ERROR) => {
                self.archive_databases()
            }
            Err(error) => Err(error),
        }
    }

    fn archive_databases(&self) -> StoreResult<()> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| STORE_ERROR)?
            .as_millis();
        let recovery = self.directory.join(RECOVERY_DIRECTORY);
        private_directory()
            .recursive(true)
            .create(&recovery)
            .map_err(|_| STORE_ERROR)?;
        // Fails instead of reusing a folder, so an earlier copy is never overwritten.
        let archive = recovery.join(stamp.to_string());
        private_directory()
            .create(&archive)
            .map_err(|_| STORE_ERROR)?;
        let mut moved = Vec::new();
        // The legacy file goes first: left alone, it would be imported into the new workspace.
        for database in [LEGACY_DATABASE, DATABASE] {
            // Journals move before their database, so none is left to apply to a new file.
            for suffix in ["-journal", "-wal", "-shm", ""] {
                let name = format!("{database}{suffix}");
                let source = self.directory.join(&name);
                let result = source.try_exists().and_then(|exists| {
                    if exists {
                        fs::rename(&source, archive.join(&name))?;
                        moved.push(name.clone());
                    }
                    Ok(())
                });
                if result.is_err() {
                    for name in moved.iter().rev() {
                        // Best effort: whatever cannot return stays safe in the recovery folder.
                        let _ = fs::rename(archive.join(name), self.directory.join(name));
                    }
                    return Err(STORE_ERROR);
                }
            }
        }
        Ok(())
    }

    fn open_locked(
        &self,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<Connection> {
        let path = self.directory.join(DATABASE);
        let legacy_path = self.directory.join(LEGACY_DATABASE);
        let legacy = || -> StoreResult<Option<Connection>> {
            if !legacy_path.try_exists().map_err(|_| STORE_ERROR)? {
                return Ok(None);
            }
            Connection::open_with_flags(&legacy_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map(Some)
                .map_err(|_| STORE_ERROR)
        };
        let can_create = if path.try_exists().map_err(|_| STORE_ERROR)? {
            false
        } else if let Some(db) = legacy()? {
            let workspace = workspace_record(&db)?.is_some();
            let sessions: bool = has_legacy_sessions(&db)?
                && db
                    .query_row("SELECT EXISTS (SELECT 1 FROM session)", [], |row| {
                        row.get(0)
                    })
                    .map_err(|_| STORE_ERROR)?;
            !workspace && !sessions
        } else {
            true
        };
        let key = load_key(can_create)?;
        let mut db = connect(&path, &key)?;
        let version: usize = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| STORE_ERROR)?;
        if version == MIGRATIONS.len()
            && db
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM native_migration)",
                    [],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|_| STORE_ERROR)?
        {
            return Ok(db);
        }
        {
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| STORE_ERROR)?;
            let version: usize = tx
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(|_| STORE_ERROR)?;
            let remaining = MIGRATIONS.get(version..).ok_or(NEWER_VERSION_ERROR)?;
            if version == 0
                && tx
                    .query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|_| STORE_ERROR)?
                    != 0
            {
                return Err(STORE_ERROR);
            }
            for sql in remaining {
                tx.execute_batch(sql).map_err(|_| STORE_ERROR)?;
            }
            if !remaining.is_empty() {
                tx.pragma_update(None, "user_version", MIGRATIONS.len())
                    .map_err(|_| STORE_ERROR)?;
            }

            if !remaining.is_empty() {
                tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS native_migration (id INTEGER PRIMARY KEY CHECK (id = 1));
                 CREATE TABLE IF NOT EXISTS native_sessions (origin TEXT PRIMARY KEY, cookie BLOB NOT NULL) STRICT;",
                ).map_err(|_| STORE_ERROR)?;
            }
            let copied: bool = tx
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM native_migration)",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| STORE_ERROR)?;
            if !copied {
                if let Some(legacy) = legacy()? {
                    if let Some((generation, encrypted)) = workspace_record(&legacy)? {
                        let plaintext = decrypt(&key, generation, &encrypted)?;
                        let workspace =
                            serde_json::from_slice(&plaintext).map_err(|_| DECRYPTION_ERROR)?;
                        let profile = super::legacy::profile(workspace, generation)
                            .ok_or(DECRYPTION_ERROR)?;
                        tx.execute(IMPORT_PROFILE, [profile.to_string()])
                            .map_err(|_| STORE_ERROR)?;
                    }
                    if has_legacy_sessions(&legacy)? {
                        let mut query = legacy
                            .prepare("SELECT origin, encrypted FROM session")
                            .map_err(|_| STORE_ERROR)?;
                        let mut sessions = query.query([]).map_err(|_| STORE_ERROR)?;
                        while let Some(session) = sessions.next().map_err(|_| STORE_ERROR)? {
                            let origin: String = session.get(0).map_err(|_| STORE_ERROR)?;
                            let encrypted: Vec<u8> = session.get(1).map_err(|_| STORE_ERROR)?;
                            let cookie = open_sealed(&key, &session_aad(&origin), &encrypted)?;
                            tx.execute(
                                "INSERT INTO native_sessions (origin, cookie) VALUES (?1, ?2)",
                                params![origin, &cookie[..]],
                            )
                            .map_err(|_| STORE_ERROR)?;
                        }
                    }
                }
                tx.execute("INSERT INTO native_migration VALUES (1)", [])
                    .map_err(|_| STORE_ERROR)?;
            }
            tx.commit().map_err(|_| STORE_ERROR)?;
        }
        Ok(db)
    }

    pub(super) fn read_relational(
        &self,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<Option<VersionedWorkspace>> {
        let db = self.open_relational(load_key)?;
        let profile: Option<String> = db
            .query_row(READ_PROFILE, [true], |row| row.get(0))
            .optional()
            .map_err(|_| STORE_ERROR)?;
        profile
            .map(|profile| {
                let value = serde_json::from_str(&profile).map_err(|_| STORE_ERROR)?;
                document(value).ok_or(STORE_ERROR)
            })
            .transpose()
    }

    pub(super) fn write_relational(
        &self,
        expected: Option<i64>,
        value: Value,
        load_key: impl FnOnce(bool) -> StoreResult<StoreKey>,
    ) -> StoreResult<VersionedWorkspace> {
        let mut db = self.open_relational(load_key)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| STORE_ERROR)?;
        let current = tx
            .query_row("SELECT generation FROM selection WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| STORE_ERROR)?;
        if current != expected {
            return Err(SAVE_CONFLICT);
        }
        let generation = current
            .unwrap_or_default()
            .checked_add(1)
            .filter(|value| *value <= MAX_GENERATION)
            .ok_or(STORE_ERROR)?;
        let mut profile = super::legacy::profile(value.clone(), generation).ok_or(STORE_ERROR)?;
        profile["replaceSpaces"] = json!(true);
        let serialized = Zeroizing::new(profile.to_string());
        if serialized.len() > MAX_DOCUMENT_BYTES {
            return Err(
                "O espaço de trabalho excede o limite de armazenamento local desta versão.",
            );
        }
        tx.execute(SAVE_PROFILE, [serialized.as_str()])
            .map_err(|_| STORE_ERROR)?;
        tx.commit().map_err(|_| STORE_ERROR)?;
        Ok(VersionedWorkspace { generation, value })
    }

    pub(super) fn read_relational_session(
        &self,
        origin: &str,
    ) -> StoreResult<Option<Zeroizing<Vec<u8>>>> {
        let db = self.open_relational(|can_create| self.storage_key(can_create))?;
        db.query_row(
            "SELECT cookie FROM native_sessions WHERE origin = ?1",
            [origin],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map(|cookie| cookie.map(Zeroizing::new))
        .map_err(|_| STORE_ERROR)
    }

    pub(super) fn write_relational_session(
        &self,
        origin: &str,
        value: Option<&[u8]>,
    ) -> StoreResult<()> {
        let db = self.open_relational(|can_create| self.storage_key(can_create))?;
        if let Some(value) = value {
            db.execute(
                "INSERT INTO native_sessions (origin, cookie) VALUES (?1, ?2)
                 ON CONFLICT (origin) DO UPDATE SET cookie = excluded.cookie",
                params![origin, value],
            )
            .map_err(|_| STORE_ERROR)?;
        } else {
            db.execute("DELETE FROM native_sessions WHERE origin = ?1", [origin])
                .map_err(|_| STORE_ERROR)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_store_reopens_with_its_file_key_and_refuses_to_replace_a_lost_key() {
        let dir = tempfile::tempdir().unwrap();
        let open_store = || WorkspaceStore::new_dev(dir.path().into());
        let store = open_store();
        store
            .open_relational(|can_create| store.storage_key(can_create))
            .unwrap();

        let key = dir.path().join("workspace.key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&key).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let store = open_store();
        store
            .open_relational(|can_create| store.storage_key(can_create))
            .unwrap();

        fs::remove_file(&key).unwrap();
        let store = open_store();
        assert_eq!(
            store
                .open_relational(|can_create| store.storage_key(can_create))
                .err(),
            Some(DEV_KEY_MISSING_ERROR)
        );
        assert!(!key.exists());
    }

    fn key(_: bool) -> StoreResult<StoreKey> {
        Ok(Zeroizing::new([7; 32]))
    }

    fn workspace() -> Value {
        json!({
            "preferences": { "timezone": "UTC", "theme": "system" },
            "projects": [{
                "id": "inbox", "revision": 1, "isInbox": true,
                "data": { "name": "Inbox", "archived": false, "view": { "layout": "list", "sortMode": "manual", "showCompleted": false } }
            }],
            "sections": [], "labels": [], "taskLabels": [], "occurrences": [], "tasks": [],
        })
    }

    fn store_at(directory: &Path) -> WorkspaceStore {
        WorkspaceStore::new(directory.to_path_buf(), "app.feito.sqlite.test".into())
    }

    fn local_document() -> Value {
        json!({ "version": 1, "active": "local", "local": workspace() })
    }

    fn missing_key(can_create: bool) -> StoreResult<StoreKey> {
        assert!(!can_create, "existing data must never receive a new key");
        Err(KEY_MISSING_ERROR)
    }

    fn archived(directory: &Path) -> std::path::PathBuf {
        let mut entries = fs::read_dir(directory.join(RECOVERY_DIRECTORY)).unwrap();
        let archive = entries.next().unwrap().unwrap().path();
        assert!(entries.next().is_none());
        archive
    }

    #[test]
    fn sets_aside_the_databases_when_the_key_is_gone_and_starts_empty() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path();
        let store = store_at(path);
        store.write(None, local_document(), key).unwrap();
        // Converting the legacy file already created the first generation.
        store
            .write_relational(Some(1), local_document(), key)
            .unwrap();
        fs::write(path.join("feito-relational.sqlite3-journal"), b"journal").unwrap();
        let legacy = fs::read(path.join(LEGACY_DATABASE)).unwrap();
        let relational = fs::read(path.join(DATABASE)).unwrap();
        assert_eq!(
            store.read_relational(missing_key).err(),
            Some(KEY_MISSING_ERROR)
        );

        store.archive_unreadable(missing_key).unwrap();

        let archive = archived(path);
        assert_eq!(fs::read(archive.join(LEGACY_DATABASE)).unwrap(), legacy);
        assert_eq!(fs::read(archive.join(DATABASE)).unwrap(), relational);
        assert!(archive.join("feito-relational.sqlite3-journal").exists());
        assert!(!path.join(LEGACY_DATABASE).exists());
        assert!(!path.join(DATABASE).exists());
        assert!(!path.join("feito-relational.sqlite3-journal").exists());
        let fresh = store
            .read_relational(|can_create| {
                assert!(can_create);
                Ok(Zeroizing::new([8; 32]))
            })
            .unwrap();
        assert!(fresh.is_none());
        // The copy still opens once the original key and files are back.
        let restored = tempfile::tempdir().unwrap();
        fs::copy(archive.join(DATABASE), restored.path().join(DATABASE)).unwrap();
        let loaded = store_at(restored.path())
            .read_relational(key)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.value["local"]["projects"][0]["id"], "inbox");
    }

    #[test]
    fn sets_aside_a_legacy_only_workspace_whose_key_is_gone() {
        let directory = tempfile::tempdir().unwrap();
        let store = store_at(directory.path());
        store.write(None, local_document(), key).unwrap();

        store.archive_unreadable(missing_key).unwrap();

        assert!(archived(directory.path()).join(LEGACY_DATABASE).exists());
        assert!(store.read_relational(key).unwrap().is_none());
    }

    #[test]
    fn sets_aside_data_that_the_vault_key_cannot_open() {
        let directory = tempfile::tempdir().unwrap();
        let store = store_at(directory.path());
        store.write_relational(None, local_document(), key).unwrap();
        let wrong = |_| Ok(Zeroizing::new([8; 32]));
        assert_eq!(store.read_relational(wrong).err(), Some(DECRYPTION_ERROR));

        store.archive_unreadable(wrong).unwrap();

        assert!(archived(directory.path()).join(DATABASE).exists());
        assert!(store.read_relational(wrong).unwrap().is_none());
    }

    #[test]
    fn keeps_data_that_opens_or_may_open_later() {
        let directory = tempfile::tempdir().unwrap();
        let store = store_at(directory.path());
        store.write_relational(None, local_document(), key).unwrap();

        store.archive_unreadable(key).unwrap();
        assert_eq!(
            store.archive_unreadable(|_| Err(KEY_ERROR)).err(),
            Some(KEY_ERROR)
        );

        assert!(!directory.path().join(RECOVERY_DIRECTORY).exists());
        assert!(store.read_relational(key).unwrap().is_some());
    }

    #[test]
    fn keeps_data_written_by_a_newer_version() {
        let directory = tempfile::tempdir().unwrap();
        let store = store_at(directory.path());
        store.write_relational(None, local_document(), key).unwrap();
        store
            .open_relational(key)
            .unwrap()
            .pragma_update(None, "user_version", MIGRATIONS.len() + 1)
            .unwrap();

        assert_eq!(store.read_relational(key).err(), Some(NEWER_VERSION_ERROR));
        assert_eq!(
            store.archive_unreadable(key).err(),
            Some(NEWER_VERSION_ERROR)
        );
        assert!(directory.path().join(DATABASE).exists());
        assert!(!directory.path().join(RECOVERY_DIRECTORY).exists());
    }

    #[test]
    fn keeps_data_behind_a_storage_failure() {
        let directory = tempfile::tempdir().unwrap();
        let store = store_at(directory.path());
        // SQLite cannot open a directory: a disk problem, not a lost key.
        fs::create_dir(directory.path().join(DATABASE)).unwrap();

        assert_eq!(store.archive_unreadable(key).err(), Some(STORE_ERROR));
        assert!(directory.path().join(DATABASE).exists());
        assert!(!directory.path().join(RECOVERY_DIRECTORY).exists());
    }

    #[test]
    fn names_each_open_failure_for_the_interface() {
        for (message, code) in [
            (KEY_MISSING_ERROR, "key-missing"),
            (KEY_ERROR, "vault-unavailable"),
            (DECRYPTION_ERROR, "unreadable"),
            (NEWER_VERSION_ERROR, "newer-version"),
            (STORE_ERROR, "storage"),
        ] {
            assert_eq!(
                serde_json::to_value(OpenFailure::from(message)).unwrap(),
                json!({ "code": code, "message": message })
            );
        }
    }

    #[test]
    fn stores_task_comments_and_removes_them_with_their_task() {
        let directory = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(
            directory.path().to_path_buf(),
            "app.feito.sqlite.test".into(),
        );
        let mut local = workspace();
        local["tasks"] = json!([{
            "id": "task", "revision": 1, "projectId": "inbox", "sectionId": null, "parentId": null,
            "occurrenceId": null,
            "data": { "title": "Commented", "description": "", "priority": 4, "position": 0,
                "createdAt": "2026-11-22T00:00:00Z", "completedAt": null, "dueDate": null,
                "dueTime": null, "recurrenceRule": null }
        }]);
        local["comments"] = json!([{
            "id": "comment", "taskId": "task", "revision": 2,
            "data": { "body": "Synthetic note", "createdAt": "2026-11-22T00:00:00Z",
                "editedAt": "2026-11-22T01:00:00Z" }
        }]);
        let document = json!({ "version": 1, "active": "local", "local": local });
        store.write_relational(None, document.clone(), key).unwrap();
        let loaded = store.read_relational(key).unwrap().unwrap();
        assert_eq!(loaded.value["local"]["comments"], local["comments"]);

        let mut without_task = document;
        without_task["local"]["tasks"] = json!([]);
        without_task["local"]
            .as_object_mut()
            .unwrap()
            .remove("comments");
        store.write_relational(Some(1), without_task, key).unwrap();
        let loaded = store.read_relational(key).unwrap().unwrap();
        assert_eq!(loaded.value["local"]["comments"], json!([]));
        let db = store.open_relational(key).unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM task_comments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migrates_a_document_from_before_the_sqlite_session_table() {
        let directory = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(
            directory.path().to_path_buf(),
            "app.feito.sqlite.test".into(),
        );
        store
            .write(
                None,
                json!({ "version": 1, "active": "local", "local": workspace() }),
                key,
            )
            .unwrap();
        store
            .open()
            .unwrap()
            .execute_batch("DROP TABLE session")
            .unwrap();
        let migrated = store.read_relational(key).unwrap().unwrap();
        assert_eq!(migrated.value["local"]["projects"][0]["id"], "inbox");
        let db = store.open_relational(key).unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM native_sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migrates_and_updates_the_native_profile_and_session_without_reopening_the_legacy_file() {
        let directory = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::new(
            directory.path().to_path_buf(),
            "app.feito.sqlite.test".into(),
        );
        let origin = "https://example.invalid";
        let legacy = json!({ "version": 1, "active": "server", "local": workspace(),
            "server": {
                "origin": origin, "user": { "id": "account", "email": "account@example.invalid" },
                "confirmed": workspace(), "working": workspace(), "cursor": 7,
                "pending": [{ "id": "operation", "method": "PATCH", "path": "/tasks/task",
                    "body": { "title": "Legacy edit" }, "generatedIds": [], "authoredAt": "2026-11-22T00:00:00Z" }],
            },
        });
        store.write(None, legacy, key).unwrap();
        store
            .write_session_with(origin, Some(b"synthetic-cookie"), key)
            .unwrap();
        let source = directory.path().join("feito.sqlite3");
        let before = fs::read(&source).unwrap();
        let initial = store.read_relational(key).unwrap().unwrap();
        assert_eq!(initial.generation, 1);
        assert_eq!(initial.value["server"]["pending"][0]["id"], "operation");
        let db = store.open_relational(key).unwrap();
        let cookie: Vec<u8> = db
            .query_row(
                "SELECT cookie FROM native_sessions WHERE origin = ?1",
                [origin],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cookie, b"synthetic-cookie");
        drop(db);
        assert_eq!(fs::read(&source).unwrap(), before);

        let mut next = initial.value;
        next["server"]["pending"] = json!([]);
        next["server"]["cursor"] = json!(8);
        assert_eq!(
            store.write_relational(Some(0), next.clone(), key).err(),
            Some(SAVE_CONFLICT)
        );
        store.write_relational(Some(1), next, key).unwrap();
        fs::write(source, b"damaged legacy copy after migration").unwrap();
        let loaded = store.read_relational(key).unwrap().unwrap();
        assert_eq!(loaded.value["server"]["cursor"], 8);
        assert_eq!(loaded.value["server"]["pending"], json!([]));
        assert_eq!(loaded.value["local"]["projects"][0]["id"], "inbox");
        assert_eq!(
            store.read_relational(|_| Ok(Zeroizing::new([9; 32]))).err(),
            Some(DECRYPTION_ERROR)
        );
    }
}
