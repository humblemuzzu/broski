use std::sync::Arc;

use broski_link_session as link;
use broski_link_session::{BridgeState, BridgeStatus, LinkState, SendFailure, WaitReason};

use crate::record::MachineRecord;

pub type LinkStatus = link::Status;
pub type LinkRoute = link::Route;

#[uniffi::remote(Record)]
pub struct LinkStatus {
    pub state: LinkState,
    pub route: Option<LinkRoute>,
    pub route_detail: Option<String>,
    pub last_seen_ms: Option<u64>,
    pub close_code: Option<u16>,
}

#[uniffi::remote(Enum)]
pub enum LinkState {
    Connecting,
    Connected { resumed: bool, session_reset: bool },
    Waiting(WaitReason),
    Revoked,
    Closed,
}

#[uniffi::remote(Enum)]
pub enum WaitReason {
    Retry,
    Paused,
    MachineOffline,
    MachineAsleep,
    RelayRefused,
}

#[uniffi::remote(Enum)]
pub enum LinkRoute {
    Lan,
    Relay,
}

#[uniffi::remote(Record)]
pub struct BridgeStatus {
    pub state: BridgeState,
    pub conn: u64,
    pub detail: Option<String>,
}

#[uniffi::remote(Enum)]
pub enum BridgeState {
    Up,
    Connecting,
    Starting,
    Down,
    Crashed,
    Unknown,
}

#[uniffi::remote(Error)]
pub enum SendFailure {
    QueueFull,
    TooLarge,
    Rejected,
    SessionReset,
    Closed,
}

/// What a session tells the app, in order (`broski_link_session::Event`).
#[derive(uniffi::Enum)]
pub enum LinkEvent {
    /// The link's state changed; `Connected` with `session_reset` means the app must resync.
    Status { status: LinkStatus },
    /// One message on the bridge stream: a contract frame for `decode_frame`.
    Bridge { frame: Vec<u8> },
    /// The daemon's report on this session's bridge socket.
    BridgeStatus { status: BridgeStatus },
    /// The machine's routes changed; persist the record in place of the stored one.
    RecordChanged { record: Arc<MachineRecord> },
    /// A message the session accepted will never be sent; `tag` is the one it was sent with.
    SendFailed {
        tag: Option<String>,
        reason: SendFailure,
    },
}

impl From<link::Event> for LinkEvent {
    fn from(event: link::Event) -> LinkEvent {
        match event {
            link::Event::Status(status) => LinkEvent::Status { status },
            link::Event::Bridge(frame) => LinkEvent::Bridge { frame },
            link::Event::BridgeStatus(status) => LinkEvent::BridgeStatus { status },
            link::Event::RecordChanged(record) => LinkEvent::RecordChanged {
                record: Arc::new(MachineRecord(record)),
            },
            link::Event::SendFailed { tag, reason } => LinkEvent::SendFailed { tag, reason },
        }
    }
}
