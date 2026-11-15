use broski_link_session::Error as LinkError;

/// Every expected failure of the core. Each case reaches Swift and Kotlin with the Rust message,
/// so the app can branch on the case and still show or log what happened.
#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum CoreError {
    #[error("{0}")]
    Identity(String),
    #[error("{0}")]
    Offer(String),
    #[error("{0}")]
    OfferExpired(String),
    /// A pairing already took this offer's one-time secret; scan or parse it again to retry.
    #[error("the offer was already used for a pairing")]
    OfferUsed,
    #[error("{0}")]
    Record(String),
    #[error("{0}")]
    MachineUnreachable(String),
    #[error("{0}")]
    FingerprintMismatch(String),
    #[error("{0}")]
    PairingRejected(String),
    #[error("{0}")]
    PairingTimeout(String),
    #[error("{0}")]
    Push(String),
    #[error("{0}")]
    Randomness(String),
    #[error("the link runtime could not start: {0}")]
    RuntimeStart(String),
    #[error("{0}")]
    RuntimeStopped(String),
    /// Bytes from the bridge stream that are not a contract frame this build can read.
    #[error("{0}")]
    Frame(String),
}

impl From<LinkError> for CoreError {
    fn from(error: LinkError) -> CoreError {
        let message = error.to_string();
        match error {
            LinkError::Identity(_) => CoreError::Identity(message),
            LinkError::Offer(_) => CoreError::Offer(message),
            LinkError::OfferExpired => CoreError::OfferExpired(message),
            LinkError::Record(_) => CoreError::Record(message),
            LinkError::MachineUnreachable => CoreError::MachineUnreachable(message),
            LinkError::FingerprintMismatch => CoreError::FingerprintMismatch(message),
            LinkError::PairingRejected(_) => CoreError::PairingRejected(message),
            LinkError::PairingTimeout => CoreError::PairingTimeout(message),
            LinkError::Push(_) => CoreError::Push(message),
            LinkError::Randomness => CoreError::Randomness(message),
            LinkError::RuntimeStopped => CoreError::RuntimeStopped(message),
        }
    }
}
