//! Sans-IO reliability layer for Broski Link: one [`Session`] per logical
//! phone/machine session, one [`Frame`] per Noise transport message, and
//! [`Hello`]/[`Welcome`] in the handshake payloads. No sockets, no clock:
//! drain `poll_transmit` into Noise, call `handle_timeout(now_ms)` when
//! `poll_timeout` is due, feed every received Noise message to `handle_frame`,
//! then drain `poll_event`.

#![forbid(unsafe_code)]

mod ack;
mod codec;
mod config;
mod cursor;
mod error;
mod event;
mod frame;
mod hello;
mod keepalive;
mod reassembly;
mod session;

pub use config::Config;
pub use error::Error;
pub use event::Event;
pub use frame::{Frame, Kind, FLAG_DEFLATE, FLAG_MORE, HEADER_LEN};
pub use hello::{Hello, Resume, Welcome, PROTOCOL_VERSION};
pub use session::Session;
