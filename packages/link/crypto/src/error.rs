use thiserror::Error;

pub type Result<T> = core::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("malformed input: {0}")]
    Malformed(&'static str),
    #[error("unsupported version {0}")]
    UnsupportedVersion(u8),
    #[error("payload of {len} bytes exceeds the {max} byte limit")]
    PayloadTooLarge { len: usize, max: usize },
    #[error("message of {len} bytes exceeds the {max} byte limit")]
    MessageTooLarge { len: usize, max: usize },
    #[error("pairing secret required for Pair mode")]
    PairingSecretRequired,
    #[error("not a broski pair uri")]
    NotAPairUri,
    #[error("key generation failed")]
    KeyGeneration,
    #[error("handshake failed: {0}")]
    Handshake(String),
    #[error("transport failed: {0}")]
    Transport(String),
}

impl From<clatter::error::HandshakeError> for Error {
    fn from(error: clatter::error::HandshakeError) -> Self {
        Self::Handshake(error.to_string())
    }
}

impl From<clatter::error::TransportError> for Error {
    fn from(error: clatter::error::TransportError) -> Self {
        Self::Transport(error.to_string())
    }
}
