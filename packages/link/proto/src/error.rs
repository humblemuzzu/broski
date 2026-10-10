use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("{what} ended before the layout was complete")]
    Truncated { what: &'static str },
    #[error("{what} has {len} bytes past the end of the layout")]
    TrailingBytes { what: &'static str, len: usize },
    #[error("frame of {len} bytes exceeds max_frame {max}")]
    FrameTooLarge { len: usize, max: usize },
    #[error("unknown frame kind {0}")]
    UnknownKind(u8),
    #[error("reserved bits set in flags {0:#04x}")]
    ReservedFlags(u8),
    #[error("CLOSE payload is {0} bytes, expected 2")]
    ClosePayload(usize),
    #[error("unknown protocol version {0}")]
    UnknownVersion(u8),
    #[error("DATA seq {got} arrived while expecting {expected}")]
    UnexpectedSeq { got: u64, expected: u64 },
    #[error("message fragments jump from stream {expected} to stream {got}")]
    InterleavedStream { expected: u32, got: u32 },
    #[error("message of {len} bytes exceeds max_message {max}")]
    MessageTooLarge { len: usize, max: usize },
    #[error("inflated message exceeds max_message {max}")]
    InflateTooLarge { max: usize },
    #[error("malformed deflate stream")]
    Inflate,
    #[error("backpressure: {pending} unacked bytes hold the limit {limit}")]
    Backpressure { pending: usize, limit: usize },
    #[error("resume mismatch: peer expected seq {peer}, local unacked window [{oldest}, {sent})")]
    ResumeMismatch { peer: u64, oldest: u64, sent: u64 },
    #[error("config rejected: {0}")]
    Config(&'static str),
}
