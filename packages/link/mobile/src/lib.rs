//! BroskiCore, the library the iOS and Android apps link: the phone's client core (`broski-client`)
//! exported to Swift and Kotlin through UniFFI, with the functions the notification handlers and the
//! pairing scanner call without a `Phone`.
//!
//! Every export is a thin wrapper; the behaviour lives in the client, session and contract crates.
//! No export takes a foreign callback: updates are pulled (`next_event`, `next_update`,
//! `next_change`). Every async export can be polled from a Swift task or a Kotlin coroutine without
//! blocking its thread, because the client waits on `Notify`s and runs its timers on the link
//! runtime's own thread.

mod inbox;
mod link;
mod machine;
mod offer;
mod phone;
mod push;
mod record;
mod values;
mod version;
mod views;

pub use inbox::Inbox;
pub use link::{LinkRoute, LinkStatus};
pub use machine::Machine;
pub use offer::{parse_pairing_offer, PairingOffer};
pub use phone::{new_identity_secret, Phone};
pub use push::{
    decision_letter, open_notification, HttpHeader, LetterRequest, PushDecision, PushNotification,
};
pub use record::MachineRecord;
pub use version::{core_version, CoreVersion};
pub use views::{SessionList, SessionView, TerminalView};

uniffi::setup_scaffolding!();
