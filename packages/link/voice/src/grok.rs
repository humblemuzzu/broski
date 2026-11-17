//! xAI's speech-to-text REST call (docs.x.ai, "Speech to Text"): one `multipart/form-data` upload
//! of the whole recording, answered with the transcript.

use serde_json::Value;

use crate::languages;
use crate::multipart::{self, Part, Value as PartValue};
use crate::terms::MAX_TERMS;
use crate::words;

pub const ENDPOINT: &str = "https://api.x.ai/v1/stt";
pub const MODEL: &str = "grok-voice-transcribe-2.0";

/// What the app sends with its own HTTP stack, byte for byte.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// A recording as the app's recorder wrote it; xAI reads the container from the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recording {
    pub audio: Vec<u8>,
    pub file_name: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Transcription {
    /// Empty when nothing was said.
    pub text: String,
    pub language: Option<String>,
    pub duration_seconds: f64,
}

/// Why xAI did not transcribe. `detail` is xAI's own words when it gave any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DictationError {
    InvalidKey {
        detail: String,
    },
    OutOfCredits {
        detail: String,
    },
    /// The key or its team may not use speech to text, or is blocked.
    Forbidden {
        detail: String,
    },
    RateLimited {
        detail: String,
    },
    TooLarge,
    /// The request itself was refused: audio xAI could not decode, a parameter it did not take.
    Rejected {
        detail: String,
    },
    Unavailable {
        status: u16,
        detail: String,
    },
    /// An answer this crate does not know how to read.
    Unexpected {
        status: u16,
        detail: String,
    },
}

impl std::fmt::Display for DictationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DictationError::InvalidKey { detail } => write!(f, "xAI refused the API key: {detail}"),
            DictationError::OutOfCredits { detail } => {
                write!(f, "the xAI account has no credits left: {detail}")
            }
            DictationError::Forbidden { detail } => {
                write!(f, "xAI forbids this key speech to text: {detail}")
            }
            DictationError::RateLimited { detail } => {
                write!(f, "xAI is limiting requests: {detail}")
            }
            DictationError::TooLarge => f.write_str("the recording is larger than xAI takes"),
            DictationError::Rejected { detail } => write!(f, "xAI refused the request: {detail}"),
            DictationError::Unavailable { status, detail } => {
                write!(f, "xAI is unavailable ({status}): {detail}")
            }
            DictationError::Unexpected { status, detail } => {
                write!(f, "an answer xAI does not document ({status}): {detail}")
            }
        }
    }
}

impl std::error::Error for DictationError {}

impl DictationError {
    /// Whether the same recording may go again unchanged.
    pub fn retryable(&self) -> bool {
        match self {
            DictationError::RateLimited { .. } | DictationError::Unavailable { .. } => true,
            DictationError::Unexpected { status, .. } => *status >= 500 || *status == 200,
            _ => false,
        }
    }
}

/// The upload of `recording` under `api_key`. `language` pins the spoken language (an unknown
/// code is dropped, leaving detection to xAI) and turns on written-form formatting where xAI has
/// it; `terms` are sent as key terms, at most [`MAX_TERMS`], each one that xAI would refuse left out.
pub fn transcription_request(
    api_key: &str,
    recording: &Recording,
    language: Option<&str>,
    terms: &[String],
) -> HttpRequest {
    let language = language
        .map(str::trim)
        .filter(|code| languages::known(code));
    let terms: Vec<&str> = terms
        .iter()
        .map(|term| term.trim())
        .filter(|term| words::sendable(term))
        .take(MAX_TERMS)
        .collect();
    let mut parts = vec![Part {
        name: "model",
        value: PartValue::Text(MODEL),
    }];
    if let Some(code) = language {
        parts.push(Part {
            name: "language",
            value: PartValue::Text(code),
        });
        if languages::formats(code) {
            parts.push(Part {
                name: "format",
                value: PartValue::Text("true"),
            });
        }
    }
    parts.extend(terms.iter().map(|term| Part {
        name: "keyterm",
        value: PartValue::Text(term),
    }));
    parts.push(Part {
        name: "file",
        value: PartValue::File {
            file_name: &recording.file_name,
            mime_type: &recording.mime_type,
            bytes: &recording.audio,
        },
    });
    let (content_type, body) = multipart::encode(&parts);
    HttpRequest {
        url: ENDPOINT.to_owned(),
        headers: vec![
            (
                "Authorization".to_owned(),
                format!("Bearer {}", api_key.trim()),
            ),
            ("Content-Type".to_owned(), content_type),
            ("Accept".to_owned(), "application/json".to_owned()),
        ],
        body,
    }
}

/// Whether `api_key` can transcribe: a quarter second of silence, which xAI answers with an empty
/// transcript for a working key and bills next to nothing. Read its answer with
/// [`transcription_result`].
pub fn key_check_request(api_key: &str) -> HttpRequest {
    let recording = Recording {
        audio: silence(),
        file_name: "check.wav".to_owned(),
        mime_type: "audio/wav".to_owned(),
    };
    transcription_request(api_key, &recording, None, &[])
}

/// 250 ms of 16 kHz mono 16-bit silence as a WAV file.
fn silence() -> Vec<u8> {
    const RATE: u32 = 16_000;
    let data = vec![0u8; (RATE / 4 * 2) as usize];
    let mut wav = Vec::with_capacity(44 + data.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&RATE.to_le_bytes());
    wav.extend_from_slice(&(RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
    wav.extend_from_slice(&data);
    wav
}

/// What xAI's answer to [`transcription_request`] or [`key_check_request`] says.
pub fn transcription_result(status: u16, body: &[u8]) -> Result<Transcription, DictationError> {
    let json: Option<Value> = serde_json::from_slice(body).ok();
    if status == 200 {
        return json
            .as_ref()
            .and_then(transcription)
            .ok_or_else(|| DictationError::Unexpected {
                status,
                detail: excerpt(body),
            });
    }
    let detail = json
        .as_ref()
        .and_then(|json| json.get("error"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| excerpt(body));
    let code = json
        .as_ref()
        .and_then(|json| json.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let words = format!("{code} {detail}").to_lowercase();
    if (400..500).contains(&status) && (words.contains("credit") || words.contains("spending")) {
        return Err(DictationError::OutOfCredits { detail });
    }
    Err(match status {
        401 => DictationError::InvalidKey { detail },
        400 if words.contains("api key") => DictationError::InvalidKey { detail },
        402 => DictationError::OutOfCredits { detail },
        403 => DictationError::Forbidden { detail },
        413 => DictationError::TooLarge,
        429 => DictationError::RateLimited { detail },
        400 | 404 | 415 | 422 => DictationError::Rejected { detail },
        500..=599 => DictationError::Unavailable { status, detail },
        _ => DictationError::Unexpected { status, detail },
    })
}

fn transcription(json: &Value) -> Option<Transcription> {
    Some(Transcription {
        text: json.get("text")?.as_str()?.trim().to_owned(),
        language: json
            .get("language")
            .and_then(Value::as_str)
            .filter(|code| !code.is_empty())
            .map(str::to_owned),
        duration_seconds: json.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
    })
}

/// At most 300 characters of a body that was not the JSON expected, for a log or a detail line.
fn excerpt(body: &[u8]) -> String {
    String::from_utf8_lossy(body)
        .chars()
        .take(300)
        .collect::<String>()
        .trim()
        .to_owned()
}

#[cfg(test)]
#[path = "grok_tests.rs"]
mod tests;
