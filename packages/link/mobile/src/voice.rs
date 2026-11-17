//! Dictation (`broski-voice`): the names a session gives the speech model, and xAI's upload and
//! answer. Pure; the apps record, send the request themselves, and hand the answer back.

use broski_contract::{FilesListed, GitStatusRead, TranscriptItem};
use broski_voice::{DictationError, DictationLanguage, DictationSources, Recording, Transcription};

use crate::push::HttpHeader;

#[uniffi::remote(Record)]
pub struct DictationSources {
    pub items: Vec<TranscriptItem>,
    pub folder: Option<FilesListed>,
    pub git: Option<GitStatusRead>,
    pub cwd: Option<String>,
    pub dictionary: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct Transcription {
    pub text: String,
    pub language: Option<String>,
    pub duration_seconds: f64,
}

#[uniffi::remote(Record)]
pub struct DictationLanguage {
    pub code: String,
    pub name: String,
    pub formats: bool,
}

#[uniffi::remote(Error)]
pub enum DictationError {
    InvalidKey { detail: String },
    OutOfCredits { detail: String },
    Forbidden { detail: String },
    RateLimited { detail: String },
    TooLarge,
    Rejected { detail: String },
    Unavailable { status: u16, detail: String },
    Unexpected { status: u16, detail: String },
}

/// A request the app sends as it is: `POST` to `url` with `headers` and `body`.
#[derive(uniffi::Record)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<HttpHeader>,
    pub body: Vec<u8>,
}

impl From<broski_voice::HttpRequest> for HttpRequest {
    fn from(request: broski_voice::HttpRequest) -> Self {
        HttpRequest {
            url: request.url,
            headers: request
                .headers
                .into_iter()
                .map(|(name, value)| HttpHeader { name, value })
                .collect(),
            body: request.body,
        }
    }
}

/// The names to send with a recording, best first.
#[uniffi::export]
pub fn dictation_terms(sources: DictationSources) -> Vec<String> {
    broski_voice::dictation_terms(&sources)
}

/// The upload of a recording; `language` `nil` lets xAI detect it.
#[uniffi::export]
pub fn dictation_request(
    api_key: String,
    audio: Vec<u8>,
    file_name: String,
    mime_type: String,
    language: Option<String>,
    terms: Vec<String>,
) -> HttpRequest {
    let recording = Recording {
        audio,
        file_name,
        mime_type,
    };
    broski_voice::transcription_request(&api_key, &recording, language.as_deref(), &terms).into()
}

/// A request that succeeds only when `api_key` can transcribe; its answer reads with
/// `dictation_result`.
#[uniffi::export]
pub fn dictation_key_check(api_key: String) -> HttpRequest {
    broski_voice::key_check_request(&api_key).into()
}

/// What xAI answered, from its HTTP status and body.
#[uniffi::export]
pub fn dictation_result(status: u16, body: Vec<u8>) -> Result<Transcription, DictationError> {
    broski_voice::transcription_result(status, &body)
}

/// Whether the same recording may be sent again unchanged.
#[uniffi::export]
pub fn dictation_error_retryable(error: DictationError) -> bool {
    error.retryable()
}

#[uniffi::export]
pub fn dictation_languages() -> Vec<DictationLanguage> {
    broski_voice::dictation_languages()
}
