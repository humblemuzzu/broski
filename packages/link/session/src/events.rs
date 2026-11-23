use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard, PoisonError};

use tokio::sync::Notify;

use crate::control::{BridgeStatus, MacDialog};
use crate::outbound::{OutboundQueue, SendFailure};
use crate::record::MachineRecord;
use crate::status::Status;

/// What a session tells the app, in order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    /// The link's state changed. `Connected` is the connect event: the bridge stream carries
    /// frames from here on, and `session_reset` says whether the app must resync.
    Status(Status),
    /// One message on the bridge stream: a contract frame, opaque to the session.
    Bridge(Vec<u8>),
    /// One message on the screen stream (`STREAM_SCREEN`): RFB loopback tunnel framing.
    Screen(Vec<u8>),
    /// Active macOS system prompt/crash dialogs reported by the daemon.
    MacDialogs(Vec<MacDialog>),
    /// The daemon's report on this session's bridge socket.
    BridgeStatus(BridgeStatus),
    /// The machine's routes changed; persist the record.
    RecordChanged(MachineRecord),
    /// A message the session accepted will never be sent. `tag` is the one the sender gave it.
    SendFailed {
        tag: Option<String>,
        reason: SendFailure,
    },
}

/// Bridge bytes and events the app may leave unread before the session stops reading its socket,
/// which pushes back on the machine instead of growing without bound; reading starts again once
/// the app is under half of both.
const BACKLOG_BYTES: usize = 8 * 1024 * 1024;
const BACKLOG_EVENTS: usize = 1024;

#[derive(Default)]
struct EventQueue {
    queue: VecDeque<Event>,
    bridge_bytes: usize,
    closed: bool,
}

impl EventQueue {
    fn over(&self, divisor: usize) -> bool {
        self.bridge_bytes >= BACKLOG_BYTES / divisor || self.queue.len() >= BACKLOG_EVENTS / divisor
    }
}

/// The state a session's handle and its engine share.
pub(crate) struct Shared {
    events: Mutex<EventQueue>,
    event_ready: Notify,
    drained: Notify,
    status: Mutex<Status>,
    pub(crate) outbound: Mutex<OutboundQueue>,
    pub(crate) outbound_ready: Notify,
}

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    pub(crate) fn new() -> Shared {
        Shared {
            events: Mutex::new(EventQueue::default()),
            event_ready: Notify::new(),
            drained: Notify::new(),
            status: Mutex::new(Status::starting()),
            outbound: Mutex::new(OutboundQueue::default()),
            outbound_ready: Notify::new(),
        }
    }

    pub(crate) fn emit(&self, event: Event) {
        let mut events = locked(&self.events);
        if let Event::Bridge(bytes) | Event::Screen(bytes) = &event {
            events.bridge_bytes += bytes.len();
        }
        if let Event::Status(status) = &event {
            *locked(&self.status) = status.clone();
        }
        events.queue.push_back(event);
        drop(events);
        self.event_ready.notify_one();
    }

    /// The app is behind: the engine stops reading its socket until it has `caught_up`.
    pub(crate) fn backlogged(&self) -> bool {
        locked(&self.events).over(1)
    }

    pub(crate) fn caught_up(&self) -> bool {
        !locked(&self.events).over(2)
    }

    pub(crate) async fn drained(&self) {
        self.drained.notified().await;
    }

    /// No event follows; `next_event` returns `None` once the queue is read.
    pub(crate) fn close_events(&self) {
        locked(&self.events).closed = true;
        self.event_ready.notify_one();
    }

    pub(crate) fn status(&self) -> Status {
        locked(&self.status).clone()
    }

    /// One reader at a time: a permit `notify_one` stores while nobody waits wakes the next call.
    pub(crate) async fn next_event(&self) -> Option<Event> {
        loop {
            if let Some(event) = self.pop() {
                return event;
            }
            self.event_ready.notified().await;
        }
    }

    /// `Some(None)` once the queue is closed and empty, `None` while it waits for more.
    fn pop(&self) -> Option<Option<Event>> {
        let mut events = locked(&self.events);
        let Some(event) = events.queue.pop_front() else {
            return events.closed.then_some(None);
        };
        if let Event::Bridge(bytes) | Event::Screen(bytes) = &event {
            events.bridge_bytes -= bytes.len();
        }
        if !events.over(2) {
            self.drained.notify_one();
        }
        Some(Some(event))
    }
}
