use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroizing;

pub fn open(path: &Path, key: &[u8; 32]) -> rusqlite::Result<Connection> {
    use std::fmt::Write;

    let db = Connection::open(path)?;
    let mut literal = Zeroizing::new(String::with_capacity(67));
    literal.push_str("x'");
    for byte in key {
        write!(&mut *literal, "{byte:02x}").map_err(|_| rusqlite::Error::InvalidQuery)?;
    }
    literal.push('\'');
    db.pragma_update(None, "key", literal.as_str())?;
    db.query_row("SELECT count(*) FROM sqlite_schema", [], |_| Ok(()))?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA synchronous = FULL;",
    )?;
    Ok(db)
}
