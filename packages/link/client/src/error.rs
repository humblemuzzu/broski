use broski_contract::{ProtocolErrorCode, RejectionCode};
use broski_link_session::SendFailure;

/// Why a call did not produce what it asked for. A request the bridge served and refused inside its
/// result (`Rejected`) is not an error: it comes back as the result it is, except from the helpers
/// that return nothing on success, which report it as `Rejected`.
///
/// The text a case carries is `detail`, never `message`: Kotlin's exception for a case is a
/// `Throwable`, whose `message` the generated class already overrides.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ClientError {
    /// The bridge could not handle the request at all (`error{…}`, contract README §12.1).
    #[error("the bridge refused the request ({code:?}): {detail}")]
    Refused {
        code: ProtocolErrorCode,
        detail: String,
    },
    /// The bridge served the request and said no, in the result's own `Rejected`.
    #[error("the bridge rejected the request ({code:?}): {detail}")]
    Rejected { code: RejectionCode, detail: String },
    /// The bridge speaks another major of the protocol; nothing is served until one that matches
    /// takes the link.
    #[error("the bridge speaks another protocol: {detail}")]
    Incompatible { detail: String },
    /// The link started over (a new link session, or a new bridge socket) while the request was out;
    /// whether the bridge served it is unknown. Prompts are safe to send again: the bridge
    /// de-duplicates them by `clientRequestId`.
    #[error("the link to the machine started over while the request was out")]
    LinkReset,
    /// No answer within the bridge's own deadline and the link's grace beyond it.
    #[error("no answer in time")]
    Timeout,
    /// The link session would not take the message.
    #[error("the link would not send the request: {failure:?}")]
    NotSent { failure: SendFailure },
    /// Too many requests are waiting for answers.
    #[error("too many requests are waiting for answers")]
    Overloaded,
    /// The request is one the client makes itself, or cannot be made as asked.
    #[error("{detail}")]
    InvalidRequest { detail: String },
    /// The bridge answered with a message the request does not take.
    #[error("the bridge answered with a {answer}")]
    UnexpectedAnswer { answer: String },
    /// The machine revoked this phone; only a new pairing helps.
    #[error("the machine revoked this phone")]
    Revoked,
    /// The machine was closed or forgotten on this phone.
    #[error("the machine is closed")]
    Closed,
    /// The link session refused: a pairing that failed, a record, identity or push it cannot use.
    #[error("{detail}")]
    Link {
        failure: LinkFailure,
        detail: String,
    },
}

/// What the link session refused, so a pairing screen can say what to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkFailure {
    /// The identity secret does not decode; the app surfaces it rather than making a new one.
    Identity,
    /// Not a pairing offer this build can read.
    Offer,
    /// The offer expired: the machine shows a new one.
    OfferExpired,
    /// The stored record is unusable.
    Record,
    /// No address in the offer served the machine's identity.
    MachineUnreachable,
    /// An address answered with a machine other than the one the offer pins.
    FingerprintMismatch,
    PairingRejected,
    PairingTimeout,
    /// A push the record cannot open, or a decision it cannot seal.
    Push,
    Randomness,
    /// The link runtime did not start, or has stopped.
    Runtime,
}

impl From<broski_link_session::Error> for ClientError {
    fn from(error: broski_link_session::Error) -> ClientError {
        use broski_link_session::Error;
        let failure = match &error {
            Error::Identity(_) => LinkFailure::Identity,
            Error::Offer(_) => LinkFailure::Offer,
            Error::OfferExpired => LinkFailure::OfferExpired,
            Error::Record(_) => LinkFailure::Record,
            Error::MachineUnreachable => LinkFailure::MachineUnreachable,
            Error::FingerprintMismatch => LinkFailure::FingerprintMismatch,
            Error::PairingRejected(_) => LinkFailure::PairingRejected,
            Error::PairingTimeout => LinkFailure::PairingTimeout,
            Error::Push(_) => LinkFailure::Push,
            Error::Randomness => LinkFailure::Randomness,
            Error::RuntimeStopped => LinkFailure::Runtime,
        };
        ClientError::Link {
            failure,
            detail: error.to_string(),
        }
    }
}
