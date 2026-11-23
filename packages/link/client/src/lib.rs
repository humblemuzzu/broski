//! The phone apps' client core over Broski Link: `docs/architecture/mobile-core.md`.
//!
//! Every async method can be polled from any executor: timers run on the link runtime and are
//! awaited through its handles, since UniFFI polls on the foreign caller's thread.

// The public enums cross UniFFI by value, which has no `Box`; the contract models they carry are
// inline for the same reason.
#![allow(clippy::large_enum_variant)]

// The UI replica in `tests/common` names this crate as the integration tests do.
#[cfg(test)]
extern crate self as broski_client;

mod attach;
mod catalog;
mod error;
#[cfg(test)]
mod exported;
mod inbox;
mod machine;
mod phone;
mod requests;
mod stats;
mod terminal;
mod view;
mod wait;
mod wire;

pub use broski_contract;
pub use broski_link_session::{
    BridgeState, BridgeStatus, LinkState, MachineRecord, MutedSession, NotifyPrefs, Platform,
    PushPlatform, Route, SendFailure, Status, Timings, WaitReason,
};

pub use crate::catalog::{SessionList, SessionListUpdate};
pub use crate::error::{ClientError, LinkFailure};
pub use crate::inbox::{
    AnswerOutcome, Inbox, InboxRow, InboxState, InboxUpdate, KeptSession, MachineHistory,
    PendingAsk, SeenMarker, SeenState, UnreadSession,
};
pub use crate::machine::{ContractState, Machine, MachineEvent, MachineStatus};
pub use crate::phone::{new_identity_secret, Phone, PhoneConfig};
pub use crate::stats::merge_stats_summaries;
pub use crate::terminal::{TerminalUpdate, TerminalView};
pub use crate::view::{SessionChange, SessionUpdate, SessionView, ViewEnd};
