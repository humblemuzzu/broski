use super::*;

fn recording() -> Recording {
    Recording {
        audio: b"\x00\x00\x00\x1cftypM4A audio".to_vec(),
        file_name: "dictation.m4a".to_owned(),
        mime_type: "audio/mp4".to_owned(),
    }
}

/// The request's form fields in order as (name, value), the file's value being its bytes.
fn fields(request: &HttpRequest) -> Vec<(String, Vec<u8>)> {
    let content_type = &request
        .headers
        .iter()
        .find(|(name, _)| name == "Content-Type")
        .unwrap()
        .1;
    let boundary = format!("--{}", content_type.rsplit('=').next().unwrap());
    let body = request.body.as_slice();
    let mut fields = Vec::new();
    let mut rest = &body[boundary.len() + 2..];
    while let Some(end) = find(rest, boundary.as_bytes()) {
        let part = &rest[..end - 2];
        let split = find(part, b"\r\n\r\n").unwrap();
        let header = String::from_utf8_lossy(&part[..split]).into_owned();
        let name = header
            .split("name=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap()
            .to_owned();
        fields.push((name, part[split + 4..].to_vec()));
        rest = &rest[end + boundary.len()..];
        if rest.starts_with(b"--") {
            break;
        }
        rest = &rest[2..];
    }
    fields
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn text_fields(request: &HttpRequest) -> Vec<(String, String)> {
    fields(request)
        .into_iter()
        .filter(|(name, _)| name != "file")
        .map(|(name, value)| (name, String::from_utf8(value).unwrap()))
        .collect()
}

#[test]
fn a_request_carries_the_model_language_formatting_terms_and_the_file_last() {
    let terms = vec![
        "useEffect".to_owned(),
        " SwiftUI ".to_owned(),
        "x = 1".to_owned(),
    ];
    let request = transcription_request(" xai-key\n", &recording(), Some("en"), &terms);
    assert_eq!(request.url, "https://api.x.ai/v1/stt");
    assert!(request
        .headers
        .contains(&("Authorization".to_owned(), "Bearer xai-key".to_owned())));
    assert_eq!(
        text_fields(&request),
        [
            ("model", MODEL),
            ("language", "en"),
            ("format", "true"),
            ("keyterm", "useEffect"),
            ("keyterm", "SwiftUI")
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned()))
    );
    let all = fields(&request);
    assert_eq!(all.last().unwrap(), &("file".to_owned(), recording().audio));
    let header = String::from_utf8_lossy(&request.body);
    assert!(
        header.contains("filename=\"dictation.m4a\"\r\nContent-Type: audio/mp4"),
        "{header}"
    );
}

#[test]
fn a_language_without_formatting_is_sent_alone_and_an_unknown_one_not_at_all() {
    let hindi = transcription_request("k", &recording(), Some("hi"), &[]);
    assert_eq!(
        text_fields(&hindi),
        [
            ("model".to_owned(), MODEL.to_owned()),
            ("language".to_owned(), "hi".to_owned())
        ]
    );
    let unknown = transcription_request("k", &recording(), Some("xx"), &[]);
    assert_eq!(
        text_fields(&unknown),
        [("model".to_owned(), MODEL.to_owned())]
    );
}

#[test]
fn at_most_the_limit_of_terms_goes_out() {
    let terms: Vec<String> = (0..150).map(|n| format!("Term{n}")).collect();
    let request = transcription_request("k", &recording(), None, &terms);
    assert_eq!(
        text_fields(&request)
            .iter()
            .filter(|(name, _)| name == "keyterm")
            .count(),
        MAX_TERMS
    );
}

#[test]
fn the_key_check_is_a_short_silent_wav() {
    let request = key_check_request("k");
    let (_, wav) = fields(&request).pop().unwrap();
    assert_eq!(&wav[..4], b"RIFF");
    assert_eq!(&wav[8..16], b"WAVEfmt ");
    assert_eq!(wav.len(), 44 + 8000);
    assert_eq!(
        u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize,
        wav.len() - 8
    );
}

#[test]
fn a_transcript_is_read_trimmed_with_its_language_and_duration() {
    let body = br#"{"text":" Run bun test. ","language":"en","duration":11.382,"words":[]}"#;
    assert_eq!(
        transcription_result(200, body),
        Ok(Transcription {
            text: "Run bun test.".to_owned(),
            language: Some("en".to_owned()),
            duration_seconds: 11.382
        })
    );
    let silent = br#"{"text":"","language":"","duration":0.25}"#;
    assert_eq!(
        transcription_result(200, silent),
        Ok(Transcription {
            text: String::new(),
            language: None,
            duration_seconds: 0.25
        })
    );
}

/// xAI's own answers, as they came back on 16 Nov 2026.
#[test]
fn xai_failures_read_as_what_the_person_can_do() {
    let wrong_key = br#"{"code":"Client specified an invalid argument","error":"Incorrect API key provided. You can obtain an API key from https://console.x.ai."}"#;
    assert!(matches!(
        transcription_result(400, wrong_key),
        Err(DictationError::InvalidKey { .. })
    ));
    let no_key = br#"{"code":"The request does not have valid authentication credentials","error":"No credentials presented. [WKE=unauthenticated:no-credentials]"}"#;
    assert!(matches!(
        transcription_result(401, no_key),
        Err(DictationError::InvalidKey { .. })
    ));
    let bad_audio = br#"{"error":"Failed to decode audio: BadFormat(\"Failed to decode audio (format=\\\"m4a\\\"). Check that the file is a valid audio file.\")"}"#;
    let Err(DictationError::Rejected { detail }) = transcription_result(400, bad_audio) else {
        panic!("a rejection");
    };
    assert!(detail.starts_with("Failed to decode audio"), "{detail}");
    let spent = br#"{"code":"personal-team-blocked:spending-limit","error":"You have run out of credits or need a Grok subscription."}"#;
    assert!(matches!(
        transcription_result(403, spent),
        Err(DictationError::OutOfCredits { .. })
    ));
    let exhausted = br#"{"code":"Some resource has been exhausted","error":"Your team has either used all available credits or reached its monthly spending limit."}"#;
    assert!(matches!(
        transcription_result(429, exhausted),
        Err(DictationError::OutOfCredits { .. })
    ));
    assert!(matches!(
        transcription_result(403, br#"{"error":"blocked"}"#),
        Err(DictationError::Forbidden { .. })
    ));
    assert_eq!(
        transcription_result(413, b""),
        Err(DictationError::TooLarge)
    );
}

#[test]
fn only_passing_failures_are_retryable() {
    let busy = transcription_result(429, br#"{"error":"slow down"}"#).unwrap_err();
    assert_eq!(
        busy,
        DictationError::RateLimited {
            detail: "slow down".to_owned()
        }
    );
    assert!(busy.retryable());
    let down = transcription_result(503, b"<html>upstream</html>").unwrap_err();
    assert_eq!(
        down,
        DictationError::Unavailable {
            status: 503,
            detail: "<html>upstream</html>".to_owned()
        }
    );
    assert!(down.retryable());
    let garbled = transcription_result(200, b"not json").unwrap_err();
    assert!(
        matches!(garbled, DictationError::Unexpected { status: 200, .. }) && garbled.retryable()
    );
    assert!(
        !transcription_result(400, br#"{"error":"Incorrect API key"}"#)
            .unwrap_err()
            .retryable()
    );
    assert!(!DictationError::TooLarge.retryable());
}
