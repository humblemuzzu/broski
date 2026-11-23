//! The phone side of Broski Link: the async client that owns the sockets and drives the sans-IO
//! link core for every paired machine.
//!
//! A [`LinkRuntime`] carries every [`Session`] of the app. [`pair`] turns a scanned [`Offer`] into
//! a live session and the [`MachineRecord`] the app persists; [`Session::start`] brings a stored
//! record back. A session races the machine's LAN routes against its relay, resumes its link
//! session across dropped sockets, and reports what happens as [`Event`]s pulled with
//! [`Session::next_event`]. The session does no storage I/O: secrets and records go in and come out
//! as values.

mod backoff;
mod bundle;
mod clock;
pub mod close;
mod control;
mod endpoint;
mod engine;
mod error;
mod events;
mod http;
mod identity;
mod options;
mod outbound;
mod pairing;
mod pause;
mod probe;
pub mod push;
mod race;
mod record;
mod record_codec;
mod refusal;
mod runtime;
mod segments;
mod session;
mod status;
mod tls;
mod transport;

pub use control::{BridgeState, BridgeStatus, MacDialog, Platform, PushPlatform};
pub use error::Error;
pub use events::Event;
pub use identity::DeviceIdentity;
pub use options::{SessionOptions, Timings};
pub use outbound::{SendFailure, OUTBOUND_QUEUE_MAX};
pub use pairing::{pair, Offer, Paired, PairingCredentials};
pub use record::MachineRecord;
pub use runtime::LinkRuntime;
pub use session::Session;
pub use status::{LinkState, Route, Status, WaitReason};
