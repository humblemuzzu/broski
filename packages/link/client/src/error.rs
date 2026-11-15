use broski_contract::{ProtocolErrorCode, RejectionCode};
use broski_link_session::SendFailure;

/// Why a call did not produce what it asked for. A request the bridge served and refused inside its
/// result (`Rejected`) is not an error: it comes back as the result it is, except from the helpers
/// that return nothing on success, which report it as `Rejected`.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ClientError {
    /// The bridge could not handle the request at all (`error{…}`, contract README §12.1).
    #[error("the bridge refused the request ({code:?}): {message}")]
    Refused {
        code: ProtocolErrorCode,
        message: String,
    },
    /// The bridge served the request and said no, in the result's own `Rejected`.
    #[error("the bridge rejected the request ({code:?}): {message}")]
    Rejected {
        code: RejectionCode,
        message: String,
    },
    /// The bridge speaks another major of the protocol; nothing is served until one that matches
    /// takes the link.
    #[error("the bridge speaks another protocol: {message}")]
    Incompatible { message: String },
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
    #[error("{message}")]
    InvalidRequest { message: String },
    /// The bridge answered with a message the request does not take.
    #[error("the bridge answered with a {answer}")]
    UnexpectedAnswer { answer: String },
    /// The machine revoked this phone; only a new pairing helps.
    #[error("the machine revoked this phone")]
    Revoked,
    /// The machine was closed or forgotten on this phone.
    #[error("the machine is closed")]
    Closed,
    /// The link session refused: a pairing that failed, a record or identity it cannot use.
    #[error("{message}")]
    Link { message: String },
}

impl From<broski_link_session::Error> for ClientError {
    fn from(error: broski_link_session::Error) -> ClientError {
        ClientError::Link {
            message: error.to_string(),
        }
    }
}
