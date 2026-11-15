use broski_link_core::crypto;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("the identity secret cannot be read: {0}")]
    Identity(crypto::Error),
    #[error("not a pairing offer this build can read: {0}")]
    Offer(crypto::Error),
    #[error("the pairing offer has expired")]
    OfferExpired,
    #[error("the machine record is unusable: {0}")]
    Record(&'static str),
    #[error("no address in the offer served the machine's identity")]
    MachineUnreachable,
    #[error("an address answered with a machine other than the one the offer pins")]
    FingerprintMismatch,
    #[error("the machine refused the pairing: {0}")]
    PairingRejected(&'static str),
    #[error("the machine did not confirm the pairing in time")]
    PairingTimeout,
    #[error("the push payload cannot be read: {0}")]
    Push(&'static str),
    #[error("system randomness is unavailable")]
    Randomness,
    #[error("the link runtime has stopped")]
    RuntimeStopped,
}
