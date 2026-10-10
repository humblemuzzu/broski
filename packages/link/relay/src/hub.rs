use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::Notify;

use crate::db::{Db, DbError};
use crate::limiter::Limiter;
use crate::limits::{Limits, RateLimit, LETTER_RATE};
use crate::protocol::Status;
use crate::push::PushSender;
use crate::room::Room;

pub struct Hub {
    db: Db,
    limiter: Limiter<IpAddr>,
    letters: Limiter<String>,
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    push: PushSender,
    limits: Limits,
    alert_gap: AtomicBool,
    stopping: Notify,
}

impl Hub {
    pub fn new(db: Db, rate: RateLimit, limits: Limits, push: PushSender) -> Hub {
        Hub {
            db,
            limiter: Limiter::new(rate),
            letters: Limiter::new(LETTER_RATE),
            rooms: Mutex::new(HashMap::new()),
            push,
            limits,
            alert_gap: AtomicBool::new(false),
            stopping: Notify::new(),
        }
    }

    pub fn db(&self) -> &Db {
        &self.db
    }

    pub fn push(&self) -> &PushSender {
        &self.push
    }

    pub fn limits(&self) -> Limits {
        self.limits
    }

    pub fn allow_upgrade(&self, ip: IpAddr) -> bool {
        self.limiter.allow(ip)
    }

    pub fn allow_letter(&self, machine_id: &str, device_id: &str) -> bool {
        self.letters.allow(format!("{machine_id}/{device_id}"))
    }

    pub fn note_alert_gap(&self) -> bool {
        !self.alert_gap.swap(true, Ordering::Relaxed)
    }

    pub fn room(&self, machine_id: &str) -> Option<Arc<Room>> {
        self.rooms().get(machine_id).cloned()
    }

    pub fn room_or_create(&self, machine_id: &str, last_seen: Option<i64>) -> Arc<Room> {
        let mut rooms = self.rooms();
        rooms
            .entry(machine_id.to_owned())
            .or_insert_with(|| Arc::new(Room::new(last_seen)))
            .clone()
    }

    pub async fn status(&self, machine_id: &str) -> Result<Status<'static>, DbError> {
        let Some(room) = self.room(machine_id) else {
            return Ok(Status {
                t: "status",
                machine: "offline",
                last_seen: self.db.last_seen(machine_id).await?,
            });
        };
        let snapshot = room.snapshot();
        Ok(Status {
            t: "status",
            machine: crate::protocol::machine_state(snapshot.online, snapshot.asleep),
            last_seen: snapshot.last_seen,
        })
    }

    pub async fn stopped(&self) {
        self.stopping.notified().await;
    }

    pub fn close_all(&self, code: u16, reason: &'static str) {
        self.stopping.notify_one();
        let rooms: Vec<Arc<Room>> = self.rooms().values().cloned().collect();
        for room in rooms {
            room.close_all(code, reason);
        }
    }

    fn rooms(&self) -> MutexGuard<'_, HashMap<String, Arc<Room>>> {
        self.rooms.lock().unwrap_or_else(|e| e.into_inner())
    }
}
