use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum Error {
    #[error("unsupported RFB protocol version: {0}")]
    UnsupportedVersion(String),
    #[error("server offered no supported authentication scheme")]
    UnsupportedSecurity,
    #[error("authentication failed: {0}")]
    AuthFailed(String),
    #[error("server rejected credentials")]
    AuthRejected,
    #[error("invalid framebuffer dimensions: {width}x{height}")]
    InvalidDimensions { width: u16, height: u16 },
    #[error("unsupported encoding {0}")]
    UnsupportedEncoding(i32),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("decompression failed: {0}")]
    Decompress(String),
    #[error("randomness failed")]
    Randomness,
}

pub type Result<T> = std::result::Result<T, Error>;
