use thiserror::Error;

use crate::crypto;
use crate::proto;

pub type Result<T> = core::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Crypto(#[from] crypto::Error),
    #[error(transparent)]
    Proto(#[from] proto::Error),
    #[error("no session: no handshake has completed yet")]
    NoSession,
    #[error("not connected: the current connection has no transport")]
    NotConnected,
    #[error("this link is closed")]
    Closed,
    #[error("the accepted handshake carries no resume offer")]
    NoResumeOffer,
    #[error("the accepted handshake has already been answered")]
    HandshakeConsumed,
    #[error("session id mismatch: refusing to resume into another session")]
    SessionMismatch,
    #[error("no migration is in flight")]
    NoMigration,
}
