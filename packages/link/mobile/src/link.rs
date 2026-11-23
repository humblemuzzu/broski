//! The link session's values the client hands out, restated for UniFFI.

use broski_link_session as link;
use broski_link_session::{
    BridgeState, BridgeStatus, LinkState, MutedSession, NotifyPrefs, Platform, PushPlatform,
    SendFailure, WaitReason,
};

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

#[uniffi::remote(Enum)]
pub enum SendFailure {
    QueueFull,
    TooLarge,
    Rejected,
    SessionReset,
    Closed,
}

#[uniffi::remote(Enum)]
pub enum Platform {
    Ios,
    Android,
}

#[uniffi::remote(Enum)]
pub enum PushPlatform {
    Apns,
    Fcm,
}

#[uniffi::remote(Record)]
pub struct NotifyPrefs {
    pub needs_you: bool,
    pub done: bool,
    pub failures: bool,
    pub muted: Vec<MutedSession>,
}

#[uniffi::remote(Record)]
pub struct MutedSession {
    pub backend: String,
    pub session: String,
}
