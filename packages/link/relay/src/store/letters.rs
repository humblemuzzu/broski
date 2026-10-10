use rusqlite::Connection;

use crate::db::{DbError, LetterStored};
use crate::letters::PendingLetter;
use crate::limits::{MAX_LETTERS_PER_MACHINE, MAX_LETTER_BYTES_PER_MACHINE};

pub(super) fn insert(
    conn: &Connection,
    machine: &str,
    device: &str,
    data: &[u8],
    now: i64,
) -> Result<LetterStored, DbError> {
    let (count, bytes): (i64, i64) = conn
        .prepare_cached(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(data)), 0) FROM letters WHERE machine_id = ?1",
        )?
        .query_row([machine], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let total = bytes.saturating_add(data.len() as i64);
    if count >= MAX_LETTERS_PER_MACHINE || total > MAX_LETTER_BYTES_PER_MACHINE {
        return Ok(LetterStored::Full);
    }
    conn.prepare_cached(
        "INSERT INTO letters (machine_id, device_id, data, created_at) VALUES (?1, ?2, ?3, ?4)",
    )?
    .execute((machine, device, data, now))?;
    Ok(LetterStored::Id(conn.last_insert_rowid() as u64))
}

pub(super) fn pending(
    conn: &Connection,
    machine: &str,
    cutoff: i64,
) -> Result<Vec<PendingLetter>, DbError> {
    let mut statement = conn.prepare_cached(
        "SELECT id, device_id, data, created_at FROM letters WHERE machine_id = ?1 AND created_at >= ?2 ORDER BY id ASC",
    )?;
    let rows = statement.query_map((machine, cutoff), |row| {
        Ok(PendingLetter {
            id: row.get::<_, i64>(0)? as u64,
            device: row.get(1)?,
            data: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    let mut letters = Vec::new();
    for row in rows {
        letters.push(row?);
    }
    Ok(letters)
}

pub(super) fn delete(conn: &Connection, machine: &str, id: u64) -> Result<(), DbError> {
    conn.prepare_cached("DELETE FROM letters WHERE machine_id = ?1 AND id = ?2")?
        .execute((machine, id as i64))?;
    Ok(())
}

pub(super) fn sweep(conn: &Connection, cutoff: i64) -> Result<usize, DbError> {
    let swept = conn
        .prepare_cached("DELETE FROM letters WHERE created_at < ?1")?
        .execute([cutoff])?;
    Ok(swept)
}
