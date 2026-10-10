//! Sans-IO connection engine: two handshake messages, then one sealed proto
//! frame per wire message. No sockets, no async, no clock.

mod error;
mod link;

pub use broski_link_crypto as crypto;
pub use broski_link_proto as proto;

pub use error::{Error, Result};
pub use link::{Accepted, Link, LinkEvent};

pub const STREAM_CONTROL: u32 = 0;
pub const STREAM_BRIDGE: u32 = 1;

/// Pins `max_frame` to the largest plaintext one Noise record carries.
pub const CONFIG: proto::Config = proto::Config::new(crypto::MAX_PLAINTEXT);
