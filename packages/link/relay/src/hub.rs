use std::collections::HashMap;
use std::net::IpAddr;
use std::ops::Deref;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::http::HeaderMap;
use tokio::sync::Notify;

use crate::auth::{ct_eq, header, sha256, REGISTER_HEADER};
use crate::db::{Db, DbError};
use crate::limiter::Limiter;
use crate::limits::{Limits, RateLimit, HTTP_IP_RATE, LETTER_RATE};
use crate::protocol::Status;
use crate::push::PushSender;
use crate::room::Room;

pub struct Hub {
    db: Db,
    limiter: Limiter<IpAddr>,
    http: Limiter<IpAddr>,
    letters: Limiter<String>,
    rooms: Mutex<HashMap<String, Arc<Room>>>,
    push: PushSender,
    limits: Limits,
    register: Option<[u8; 32]>,
    alert_gap: AtomicBool,
    stopping: Notify,
}

/// A socket's or an alert timer's hold on a machine's room. The room stays in the hub while any
/// lease on it is alive, and is dropped once the last one goes with nobody attached to it, so an
/// idle machine costs the relay nothing but its database row.
pub struct RoomLease {
    hub: Arc<Hub>,
    machine_id: String,
    room: Arc<Room>,
}

impl Deref for RoomLease {
    type Target = Arc<Room>;

    fn deref(&self) -> &Arc<Room> {
        &self.room
    }
}

impl Drop for RoomLease {
    fn drop(&mut self) {
        self.hub.release(&self.machine_id, &self.room);
    }
}

impl Hub {
    pub fn new(
        db: Db,
        rate: RateLimit,
        limits: Limits,
        push: PushSender,
        register: Option<[u8; 32]>,
    ) -> Hub {
        Hub {
            db,
            limiter: Limiter::new(rate),
            http: Limiter::new(HTTP_IP_RATE),
            letters: Limiter::new(LETTER_RATE),
            rooms: Mutex::new(HashMap::new()),
            push,
            limits,
            register,
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

    pub fn allow_http(&self, ip: IpAddr) -> bool {
        self.http.allow(ip)
    }

    pub fn allow_letter(&self, machine_id: &str, device_id: &str) -> bool {
        self.letters.allow(format!("{machine_id}/{device_id}"))
    }

    /// Whether a machine the relay has never seen may register with these headers.
    pub fn may_register(&self, headers: &HeaderMap) -> bool {
        match &self.register {
            None => true,
            Some(expected) => header(headers, REGISTER_HEADER)
                .is_some_and(|token| ct_eq(&sha256(token.as_bytes()), expected)),
        }
    }

    pub fn note_alert_gap(&self) -> bool {
        !self.alert_gap.swap(true, Ordering::Relaxed)
    }

    pub fn room(&self, machine_id: &str) -> Option<Arc<Room>> {
        self.rooms().get(machine_id).cloned()
    }

    pub fn room_count(&self) -> usize {
        self.rooms().len()
    }

    pub fn lease(self: &Arc<Self>, machine_id: &str, last_seen: Option<i64>) -> RoomLease {
        let mut rooms = self.rooms();
        let room = rooms
            .entry(machine_id.to_owned())
            .or_insert_with(|| Arc::new(Room::new(last_seen)))
            .clone();
        room.hold();
        RoomLease {
            hub: self.clone(),
            machine_id: machine_id.to_owned(),
            room,
        }
    }

    fn release(&self, machine_id: &str, room: &Arc<Room>) {
        let mut rooms = self.rooms();
        if room.release()
            && rooms
                .get(machine_id)
                .is_some_and(|kept| Arc::ptr_eq(kept, room))
        {
            rooms.remove(machine_id);
        }
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
