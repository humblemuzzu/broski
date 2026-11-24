use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use tokio::sync::{mpsc, oneshot};

use crate::auth::ct_eq;
use crate::db::{DbError, LetterStored, MachineAuth, PutDevice, Request};
use crate::limits::MAX_ALLOWED_DEVICES;

mod alerts;
mod letters;
mod schema;

use schema::SCHEMA;

pub(crate) struct Store {
    conn: Connection,
}

impl Store {
    pub(crate) fn open(path: &Path) -> Result<Store, DbError> {
        let conn = Connection::open(path)?;
        #[cfg(unix)]
        if path != Path::new(":memory:") {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub(crate) fn run(mut self, mut rx: mpsc::Receiver<Request>) {
        while let Some(request) = rx.blocking_recv() {
            self.handle(request);
        }
    }

    fn handle(&mut self, request: Request) {
        match request {
            Request::AuthenticateMachine {
                id,
                hash,
                now,
                may_register,
                reply,
            } => reply_with(
                self.authenticate_machine(&id, &hash, now, may_register),
                (MachineAuth::BadSecret, None),
                reply,
            ),
            Request::AuthorizeDevice {
                machine,
                device,
                hash,
                reply,
            } => reply_with(self.authorize_device(&machine, &device, &hash), None, reply),
            Request::PutDevice {
                machine,
                device,
                hash,
                now,
                reply,
            } => reply_with(
                self.put_device(&machine, &device, &hash, now),
                PutDevice::TooMany,
                reply,
            ),
            Request::DeleteDevice { machine, device } => {
                log_failure(self.delete_device(&machine, &device));
            }
            Request::KeepDevices {
                machine,
                keep,
                reply,
            } => reply_with(self.keep_devices(&machine, &keep), Vec::new(), reply),
            Request::SetPub {
                id,
                pub_bytes,
                reply,
            } => reply_with(self.set_pub(&id, &pub_bytes), false, reply),
            Request::Touch { id, ts } => log_failure(self.touch(&id, ts)),
            Request::LastSeen { id, reply } => reply_with(self.last_seen(&id), None, reply),
            Request::Identity { id, reply } => reply_with(self.identity(&id), None, reply),
            Request::InsertLetter {
                machine,
                device,
                data,
                now,
                reply,
            } => reply_with(
                letters::insert(&self.conn, &machine, &device, &data, now),
                LetterStored::Full,
                reply,
            ),
            Request::PendingLetters {
                machine,
                cutoff,
                reply,
            } => reply_with(
                letters::pending(&self.conn, &machine, cutoff),
                Vec::new(),
                reply,
            ),
            Request::DeleteLetter { machine, id, reply } => {
                reply_with(letters::delete(&self.conn, &machine, id), (), reply);
            }
            Request::SweepLetters { cutoff, reply } => {
                reply_with(letters::sweep(&self.conn, cutoff), 0, reply)
            }
            Request::PutAlertTargets {
                machine,
                targets,
                reply,
            } => reply_with(
                alerts::replace(&mut self.conn, &machine, &targets).map(|()| true),
                false,
                reply,
            ),
            Request::AlertTargets { machine, reply } => {
                reply_with(alerts::list(&self.conn, &machine), Vec::new(), reply)
            }
        }
    }

    fn authenticate_machine(
        &mut self,
        id: &str,
        hash: &[u8; 32],
        now: i64,
        may_register: bool,
    ) -> Result<(MachineAuth, Option<i64>), DbError> {
        let stored: Option<(Vec<u8>, Option<i64>)> = self
            .conn
            .prepare_cached("SELECT secret_hash, last_seen FROM machines WHERE id = ?1")?
            .query_row([id], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        match stored {
            Some((secret_hash, last_seen)) => {
                let auth = if ct_eq(&secret_hash, hash) {
                    MachineAuth::Ok
                } else {
                    MachineAuth::BadSecret
                };
                Ok((auth, last_seen))
            }
            None if !may_register => Ok((MachineAuth::Closed, None)),
            None => {
                self.conn
                    .prepare_cached(
                        "INSERT OR IGNORE INTO machines (id, secret_hash, pub, last_seen, created_at) VALUES (?1, ?2, NULL, NULL, ?3)",
                    )?
                    .execute((id, hash.as_slice(), now))?;
                Ok((MachineAuth::Registered, None))
            }
        }
    }

    fn authorize_device(
        &mut self,
        machine: &str,
        device: &str,
        hash: &[u8; 32],
    ) -> Result<Option<Option<i64>>, DbError> {
        let stored: Option<(Vec<u8>, Option<i64>)> = self
            .conn
            .prepare_cached(
                "SELECT d.token_hash, m.last_seen FROM devices d JOIN machines m ON m.id = d.machine_id WHERE d.machine_id = ?1 AND d.device_id = ?2",
            )?
            .query_row((machine, device), |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        Ok(match stored {
            Some((token_hash, last_seen)) if ct_eq(&token_hash, hash) => Some(last_seen),
            _ => None,
        })
    }

    fn put_device(
        &mut self,
        machine: &str,
        device: &str,
        hash: &[u8; 32],
        now: i64,
    ) -> Result<PutDevice, DbError> {
        let existing: bool = self
            .conn
            .prepare_cached("SELECT 1 FROM devices WHERE machine_id = ?1 AND device_id = ?2")?
            .query_row((machine, device), |_| Ok(()))
            .optional()?
            .is_some();
        if !existing {
            let count: i64 = self
                .conn
                .prepare_cached("SELECT COUNT(*) FROM devices WHERE machine_id = ?1")?
                .query_row([machine], |row| row.get(0))?;
            if count >= MAX_ALLOWED_DEVICES {
                return Ok(PutDevice::TooMany);
            }
        }
        self.conn
            .prepare_cached(
                "INSERT OR REPLACE INTO devices (machine_id, device_id, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
            )?
            .execute((machine, device, hash.as_slice(), now))?;
        Ok(PutDevice::Added)
    }

    fn delete_device(&mut self, machine: &str, device: &str) -> Result<(), DbError> {
        self.conn
            .prepare_cached("DELETE FROM devices WHERE machine_id = ?1 AND device_id = ?2")?
            .execute((machine, device))?;
        Ok(())
    }

    fn keep_devices(&mut self, machine: &str, keep: &[String]) -> Result<Vec<String>, DbError> {
        let known: Vec<String> = self
            .conn
            .prepare_cached("SELECT device_id FROM devices WHERE machine_id = ?1")?
            .query_map([machine], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        let gone: Vec<String> = known.into_iter().filter(|id| !keep.contains(id)).collect();
        for device in &gone {
            self.delete_device(machine, device)?;
        }
        Ok(gone)
    }

    fn set_pub(&mut self, id: &str, pub_bytes: &[u8]) -> Result<bool, DbError> {
        let changed = self
            .conn
            .prepare_cached("UPDATE machines SET pub = ?2 WHERE id = ?1")?
            .execute((id, pub_bytes))?;
        Ok(changed > 0)
    }

    fn touch(&mut self, id: &str, ts: i64) -> Result<(), DbError> {
        self.conn
            .prepare_cached("UPDATE machines SET last_seen = ?2 WHERE id = ?1")?
            .execute((id, ts))?;
        Ok(())
    }

    fn last_seen(&mut self, id: &str) -> Result<Option<i64>, DbError> {
        let row: Option<Option<i64>> = self
            .conn
            .prepare_cached("SELECT last_seen FROM machines WHERE id = ?1")?
            .query_row([id], |row| row.get(0))
            .optional()?;
        Ok(row.flatten())
    }

    fn identity(&mut self, id: &str) -> Result<Option<Vec<u8>>, DbError> {
        let row: Option<Option<Vec<u8>>> = self
            .conn
            .prepare_cached("SELECT pub FROM machines WHERE id = ?1")?
            .query_row([id], |row| row.get(0))
            .optional()?;
        Ok(row.flatten())
    }
}

fn reply_with<T>(result: Result<T, DbError>, fallback: T, reply: oneshot::Sender<T>) {
    let value = result.unwrap_or_else(|error| {
        warn(&error);
        fallback
    });
    let _ = reply.send(value);
}

fn log_failure(result: Result<(), DbError>) {
    if let Err(error) = result {
        warn(&error);
    }
}

fn warn(error: &DbError) {
    tracing::warn!(error = %error, "database request failed");
}
