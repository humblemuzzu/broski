//! Dictation both phone apps do the same way (`docs/architecture/dictation.md`). No I/O: the apps
//! record and send the bytes [`transcription_request`] builds, as they send `decisionLetter`'s.

mod grok;
mod languages;
mod multipart;
mod terms;
mod words;

pub use grok::{
    key_check_request, transcription_request, transcription_result, DictationError, HttpRequest,
    Recording, Transcription, ENDPOINT, MODEL,
};
pub use languages::{dictation_languages, DictationLanguage};
pub use terms::{dictation_terms, DictationSources, MAX_TERMS, MAX_TERM_CHARS};
