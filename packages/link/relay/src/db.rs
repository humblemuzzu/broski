use std::path::{Path, PathBuf};

use tokio::sync::{mpsc, oneshot};

use crate::alerts::AlertTarget;
use crate::letters::PendingLetter;
use crate::store::Store;

#[derive(Debug)]
pub struct DbError(String);

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(error: rusqlite::Error) -> Self {
        DbError(error.to_string())
    }
}

fn db_stopped() -> DbError {
    DbError("database thread stopped".to_owned())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MachineAuth {
    Registered,
    Ok,
    BadSecret,
    /// An unknown machine on a relay that registers only with its token, which was not given.
    Closed,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PutDevice {
    Added,
    TooMany,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LetterStored {
    Id(u64),
    Full,
}

pub(crate) enum Request {
    AuthenticateMachine {
        id: String,
        hash: [u8; 32],
        now: i64,
        may_register: bool,
        reply: oneshot::Sender<(MachineAuth, Option<i64>)>,
    },
    AuthorizeDevice {
        machine: String,
        device: String,
        hash: [u8; 32],
        reply: oneshot::Sender<Option<Option<i64>>>,
    },
    PutDevice {
        machine: String,
        device: String,
        hash: [u8; 32],
        now: i64,
        reply: oneshot::Sender<PutDevice>,
    },
    DeleteDevice {
        machine: String,
        device: String,
    },
    KeepDevices {
        machine: String,
        keep: Vec<String>,
        reply: oneshot::Sender<Vec<String>>,
    },
    SetPub {
        id: String,
        pub_bytes: Vec<u8>,
        reply: oneshot::Sender<bool>,
    },
    Touch {
        id: String,
        ts: i64,
    },
    LastSeen {
        id: String,
        reply: oneshot::Sender<Option<i64>>,
    },
    Identity {
        id: String,
        reply: oneshot::Sender<Option<Vec<u8>>>,
    },
    InsertLetter {
        machine: String,
        device: String,
        data: Vec<u8>,
        now: i64,
        reply: oneshot::Sender<LetterStored>,
    },
    PendingLetters {
        machine: String,
        cutoff: i64,
        reply: oneshot::Sender<Vec<PendingLetter>>,
    },
    DeleteLetter {
        machine: String,
        id: u64,
        reply: oneshot::Sender<()>,
    },
    SweepLetters {
        cutoff: i64,
        reply: oneshot::Sender<usize>,
    },
    PutAlertTargets {
        machine: String,
        targets: Vec<AlertTarget>,
        reply: oneshot::Sender<bool>,
    },
    AlertTargets {
        machine: String,
        reply: oneshot::Sender<Vec<AlertTarget>>,
    },
}

pub struct Db {
    tx: mpsc::Sender<Request>,
}

impl Db {
    pub async fn open(path: &Path) -> Result<Db, DbError> {
        let (tx, rx) = mpsc::channel(64);
        let (ready_tx, ready_rx) = oneshot::channel();
        let path: PathBuf = path.to_path_buf();
        std::thread::spawn(move || match Store::open(&path) {
            Ok(store) => {
                let _ = ready_tx.send(Ok(()));
                store.run(rx);
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error));
            }
        });
        match ready_rx.await {
            Ok(Ok(())) => Ok(Db { tx }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(DbError("database thread stopped during startup".to_owned())),
        }
    }

    pub async fn authenticate_machine(
        &self,
        id: &str,
        hash: &[u8; 32],
        now: i64,
        may_register: bool,
    ) -> Result<(MachineAuth, Option<i64>), DbError> {
        self.request(|reply| Request::AuthenticateMachine {
            id: id.to_owned(),
            hash: *hash,
            now,
            may_register,
            reply,
        })
        .await
    }

    pub async fn authorize_device(
        &self,
        machine: &str,
        device: &str,
        hash: &[u8; 32],
    ) -> Result<Option<Option<i64>>, DbError> {
        self.request(|reply| Request::AuthorizeDevice {
            machine: machine.to_owned(),
            device: device.to_owned(),
            hash: *hash,
            reply,
        })
        .await
    }

    pub async fn put_device(
        &self,
        machine: &str,
        device: &str,
        hash: &[u8; 32],
        now: i64,
    ) -> Result<PutDevice, DbError> {
        self.request(|reply| Request::PutDevice {
            machine: machine.to_owned(),
            device: device.to_owned(),
            hash: *hash,
            now,
            reply,
        })
        .await
    }

    pub async fn delete_device(&self, machine: &str, device: &str) -> Result<(), DbError> {
        self.tx
            .send(Request::DeleteDevice {
                machine: machine.to_owned(),
                device: device.to_owned(),
            })
            .await
            .map_err(|_| db_stopped())
    }

    /// Deletes every device of `machine` that `keep` does not name; returns the deleted ids.
    pub async fn keep_devices(
        &self,
        machine: &str,
        keep: Vec<String>,
    ) -> Result<Vec<String>, DbError> {
        self.request(|reply| Request::KeepDevices {
            machine: machine.to_owned(),
            keep,
            reply,
        })
        .await
    }

    pub async fn set_pub(&self, id: &str, pub_bytes: Vec<u8>) -> Result<bool, DbError> {
        self.request(|reply| Request::SetPub {
            id: id.to_owned(),
            pub_bytes,
            reply,
        })
        .await
    }

    pub async fn touch_last_seen(&self, id: &str, ts: i64) -> Result<(), DbError> {
        self.tx
            .send(Request::Touch {
                id: id.to_owned(),
                ts,
            })
            .await
            .map_err(|_| db_stopped())
    }

    pub async fn last_seen(&self, id: &str) -> Result<Option<i64>, DbError> {
        self.request(|reply| Request::LastSeen {
            id: id.to_owned(),
            reply,
        })
        .await
    }

    pub async fn identity(&self, id: &str) -> Result<Option<Vec<u8>>, DbError> {
        self.request(|reply| Request::Identity {
            id: id.to_owned(),
            reply,
        })
        .await
    }

    pub async fn insert_letter(
        &self,
        machine: &str,
        device: &str,
        data: &[u8],
        now: i64,
    ) -> Result<LetterStored, DbError> {
        self.request(|reply| Request::InsertLetter {
            machine: machine.to_owned(),
            device: device.to_owned(),
            data: data.to_vec(),
            now,
            reply,
        })
        .await
    }

    pub async fn pending_letters(
        &self,
        machine: &str,
        cutoff: i64,
    ) -> Result<Vec<PendingLetter>, DbError> {
        self.request(|reply| Request::PendingLetters {
            machine: machine.to_owned(),
            cutoff,
            reply,
        })
        .await
    }

    pub async fn delete_letter(&self, machine: &str, id: u64) -> Result<(), DbError> {
        self.request(|reply| Request::DeleteLetter {
            machine: machine.to_owned(),
            id,
            reply,
        })
        .await
    }

    pub async fn sweep_letters(&self, cutoff: i64) -> Result<usize, DbError> {
        self.request(|reply| Request::SweepLetters { cutoff, reply })
            .await
    }

    pub async fn put_alert_targets(
        &self,
        machine: &str,
        targets: Vec<AlertTarget>,
    ) -> Result<bool, DbError> {
        self.request(|reply| Request::PutAlertTargets {
            machine: machine.to_owned(),
            targets,
            reply,
        })
        .await
    }

    pub async fn alert_targets(&self, machine: &str) -> Result<Vec<AlertTarget>, DbError> {
        self.request(|reply| Request::AlertTargets {
            machine: machine.to_owned(),
            reply,
        })
        .await
    }

    async fn request<R>(
        &self,
        build: impl FnOnce(oneshot::Sender<R>) -> Request,
    ) -> Result<R, DbError> {
        let (reply, response) = oneshot::channel();
        self.tx.send(build(reply)).await.map_err(|_| db_stopped())?;
        response.await.map_err(|_| db_stopped())
    }
}
