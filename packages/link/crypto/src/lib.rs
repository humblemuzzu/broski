//! End-to-end cryptography for Broski Link.
//!
//! Sans-IO: no sockets, no async, no clock. Provides the X25519 + ML-KEM-768 hybrid
//! Noise IK handshake, the static identity format and the QR pairing offer. Two peers
//! exchange exactly two handshake messages and then one [`Transport`] each, which
//! requires ordered delivery over a reliable stream.

#![forbid(unsafe_code)]

mod error;
mod handshake;
mod identity;
mod pairing;
mod suite;
mod transport;
mod uri;

pub use error::{Error, Result};
pub use handshake::{
    HandshakeMode, HandshakeModeKind, Initiator, Responder, MAX_HANDSHAKE_PAYLOAD, PROTOCOL_VERSION,
};
pub use identity::{PublicBundle, StaticIdentity, PUBLIC_BUNDLE_LEN, SECRET_BYTES_LEN};
pub use pairing::{verification_code, PairingOffer, MAX_LAN_ENTRIES, MAX_NAME_LEN};
pub use suite::SUITE;
pub use transport::{Transport, MAX_PLAINTEXT};
