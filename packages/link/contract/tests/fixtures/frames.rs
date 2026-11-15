use broski_contract::{
    decode_frame, encode_frame, ClientMessage, ServerMessage, SessionDetachResponse,
};

use crate::canonical::canonical_json;
use crate::support::{decode, encode, field, fixture, items, members, string, text_of};

fn prefix() -> String {
    string(field(&fixture("frame_prefix.json"), "prefix")).to_owned()
}

#[test]
fn the_fake_session_decodes_frame_by_frame_and_encodes_back_unchanged() {
    let prefix = prefix();
    let stream = fixture("fake_session_stream.json");
    for message in items(&stream) {
        let frame = format!("{prefix}{}}}", text_of(message));
        let decoded = decode_frame(&frame).unwrap_or_else(|error| panic!("{frame}: {error}"));
        assert_eq!(canonical_json(&encode(&decoded)), canonical_json(message));
    }
}

#[test]
fn a_frame_the_core_encoded_decodes() {
    let example = fixture("frame_prefix.json");
    let decoded = decode_frame(string(field(&example, "example"))).unwrap();
    let expected = ServerMessage::SessionDetachResult(SessionDetachResponse {
        request_id: "r".to_owned(),
    });
    assert_eq!(decoded, expected);
}

/// `JSON.stringify` writes a lone surrogate as `\ud83d`, which serde_json refuses; the core replaces it with
/// U+FFFD, so the phone keeps the whole frame.
#[test]
fn a_frame_the_core_encoded_around_lone_surrogates_decodes_with_them_replaced() {
    let example = fixture("frame_prefix.json");
    let frame = string(field(&example, "loneSurrogateExample"));
    assert!(
        !frame.contains("\\ud8") && !frame.contains("\\ude"),
        "{frame}"
    );
    let ServerMessage::Error(error) = decode_frame(frame).unwrap() else {
        panic!("not an error: {frame}");
    };
    assert_eq!(error.error.message, "a\u{FFFD}b😀\u{FFFD}c");

    let refused = frame.replace("\\ufffdb", "\\ud83db");
    assert!(decode_frame(&refused).is_err(), "{refused}");
}

/// The core reads a frame whose object holds `type` and `message` and nothing else (`framedMessage`).
#[test]
fn every_client_message_goes_out_in_a_frame_that_begins_as_the_core_s_frames_do() {
    let prefix = prefix();
    let samples = fixture("contract_samples.json");
    for sample in items(field(&samples, "ClientMessage")) {
        let message: ClientMessage = decode(sample).unwrap();
        let frame = encode_frame(&message);
        assert!(
            frame.starts_with(&prefix) && frame.ends_with('}'),
            "{frame}"
        );
        let parsed = serde_json::from_str(&frame).unwrap();
        let keys: Vec<&str> = members(&parsed)
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert_eq!(keys, ["type", "message"]);
        assert_eq!(string(field(&parsed, "type")), "contract");
        assert_eq!(
            canonical_json(field(&parsed, "message")),
            canonical_json(sample)
        );
    }
}

#[test]
fn anything_but_a_contract_frame_is_refused() {
    let message = r#"{"type":"session.detach.result","requestId":"r"}"#;
    let frames = [
        format!(r#"{{"type":"other","message":{message}}}"#),
        format!(r#"{{"type":"contract","message":{message},"extra":1}}"#),
        r#"{"type":"contract"}"#.to_owned(),
        message.to_owned(),
        "not json".to_owned(),
    ];
    for frame in frames {
        assert!(decode_frame(&frame).is_err(), "{frame}");
    }
}
