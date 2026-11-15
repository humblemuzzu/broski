//! BroskiCore, the library the iOS and Android apps link: the link session (`broski-link-session`)
//! and the contract (`broski-contract`) exported to Swift and Kotlin through UniFFI.
//!
//! Everything here is a thin wrapper; the behaviour lives in those crates. No export takes a
//! foreign callback: events are pulled with `LinkSession::next_event`. Every async export awaits
//! work the session crate runs on its own `LinkRuntime` thread, or a `Notify`, so UniFFI can poll it
//! from a Swift task or a Kotlin coroutine without blocking the caller's thread.

mod error;
mod events;
mod frame;
mod identity;
mod pairing;
mod push;
mod record;
mod runtime;
mod session;

pub use error::CoreError;
pub use events::{LinkEvent, LinkRoute, LinkStatus};
pub use frame::{decode_frame, encode_frame};
pub use identity::DeviceIdentity;
pub use pairing::{pair, PairedMachine, PairingOffer, SessionOptions};
pub use push::{
    decision_letter, open_notification, HttpHeader, LetterRequest, PushDecision, PushNotification,
};
pub use record::MachineRecord;
pub use runtime::LinkRuntime;
pub use session::LinkSession;

uniffi::setup_scaffolding!();
