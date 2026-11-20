use std::{fs, path::PathBuf, time::Duration};

use chacha20poly1305::{
    aead::{
        rand_core::{OsRng, RngCore},
        Aead, KeyInit, Payload,
    },
    XChaCha20Poly1305, XNonce,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use zeroize::Zeroizing;

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
        }
    }

    fn open(&self) -> StoreResult<Connection> {
        let mut directory = fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(&self.directory).map_err(|_| STORE_ERROR)?;
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
                );",
            )
            .map_err(|_| STORE_ERROR)?;
        Ok(database)
    }

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
        let mut nonce = [0; NONCE_BYTES];
        OsRng.try_fill_bytes(&mut nonce).map_err(|_| STORE_ERROR)?;
        let mut encrypted = nonce.to_vec();
        let ciphertext = cipher(&key)?
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: &generation.to_be_bytes(),
                },
            )
            .map_err(|_| STORE_ERROR)?;
        encrypted.extend(ciphertext);
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
    if encrypted.len() <= NONCE_BYTES {
        return Err(DECRYPTION_ERROR);
    }
    let (nonce, ciphertext) = encrypted.split_at(NONCE_BYTES);
    cipher(key)?
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &generation.to_be_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| DECRYPTION_ERROR)
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
        store.read(|can_create| system_key(&store.credential_service, can_create))
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
        store.write(generation, value, |can_create| {
            system_key(&store.credential_service, can_create)
        })
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
}
