use rusqlite::Connection;

use crate::alerts::AlertTarget;
use crate::db::DbError;
use crate::push::Platform;

pub(super) fn replace(
    conn: &mut Connection,
    machine: &str,
    targets: &[AlertTarget],
) -> Result<(), DbError> {
    let tx = conn.transaction()?;
    {
        tx.prepare_cached("DELETE FROM alert_targets WHERE machine_id = ?1")?
            .execute([machine])?;
    }
    {
        let mut statement = tx.prepare_cached(
            "INSERT OR REPLACE INTO alert_targets (machine_id, device_id, platform, token) VALUES (?1, ?2, ?3, ?4)",
        )?;
        for target in targets {
            statement.execute((
                machine,
                &target.device,
                target.platform.as_str(),
                &target.token,
            ))?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub(super) fn list(conn: &Connection, machine: &str) -> Result<Vec<AlertTarget>, DbError> {
    let mut statement = conn.prepare_cached(
        "SELECT device_id, platform, token FROM alert_targets WHERE machine_id = ?1 ORDER BY device_id",
    )?;
    let rows = statement.query_map([machine], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut targets = Vec::new();
    for row in rows {
        let (device, platform, token) = row?;
        if let Some(platform) = Platform::parse(&platform) {
            targets.push(AlertTarget {
                device,
                platform,
                token,
            });
        }
    }
    Ok(targets)
}
