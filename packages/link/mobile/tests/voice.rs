//! The dictation exports, called as the apps call them: owned values in, records out.

use broski_contract::{AttachmentRef, TranscriptItem, UserMessageItem};
use broski_core::{
    dictation_error_retryable, dictation_key_check, dictation_languages, dictation_request,
    dictation_result, dictation_terms,
};
use broski_voice::{DictationError, DictationSources};

#[test]
fn a_session_gives_names_and_a_request_carries_them() {
    let message = UserMessageItem {
        id: "u1".to_owned(),
        at: None,
        text: "Rename `isLoading` in SessionView.swift".to_owned(),
        attachments: Vec::<AttachmentRef>::new(),
        client_request_id: None,
    };
    let sources = DictationSources {
        items: vec![TranscriptItem::UserMessage(message)],
        folder: None,
        git: None,
        cwd: Some("/Users/me/broski".to_owned()),
        dictionary: vec!["Zanzibar".to_owned()],
    };
    let terms = dictation_terms(sources);
    assert_eq!(terms[..2], ["Zanzibar", "broski"]);
    assert!(
        terms.contains(&"isLoading".to_owned()) && terms.contains(&"SessionView.swift".to_owned()),
        "{terms:?}"
    );

    let request = dictation_request(
        "key".to_owned(),
        b"audio".to_vec(),
        "d.m4a".to_owned(),
        "audio/mp4".to_owned(),
        Some("en".to_owned()),
        terms,
    );
    assert_eq!(request.url, "https://api.x.ai/v1/stt");
    assert!(request
        .headers
        .iter()
        .any(|header| header.name == "Authorization" && header.value == "Bearer key"));
    assert!(String::from_utf8_lossy(&request.body).contains("isLoading"));
}

#[test]
fn answers_read_as_a_transcript_or_a_failure() {
    let text = dictation_result(
        200,
        br#"{"text":"run bun test","language":"en","duration":1.5}"#.to_vec(),
    )
    .unwrap();
    assert_eq!(
        (text.text.as_str(), text.duration_seconds),
        ("run bun test", 1.5)
    );
    let refused =
        dictation_result(400, br#"{"error":"Incorrect API key provided."}"#.to_vec()).unwrap_err();
    assert!(matches!(refused, DictationError::InvalidKey { .. }));
    assert!(!dictation_error_retryable(refused));
    assert!(dictation_error_retryable(DictationError::Unavailable {
        status: 503,
        detail: String::new()
    }));
    assert!(dictation_key_check("key".to_owned()).body.len() > 8000);
    assert!(dictation_languages()
        .iter()
        .any(|language| language.code == "en" && language.formats));
}
