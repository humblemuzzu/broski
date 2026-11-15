//! The models decode as strictly as the zod schemas parse: what zod refuses, they refuse, except an array where an
//! object belongs (the last test).

use broski_contract::{decode_frame, AgentEvent, JsonValue, SessionRef, ToolStartedEvent};

fn error_of(text: &str) -> String {
    match serde_json::from_str::<AgentEvent>(text) {
        Ok(event) => panic!("{text} decoded as {event:?}"),
        Err(error) => error.to_string(),
    }
}

#[test]
fn refuses_unknown_fields_tags_and_values_at_any_depth() {
    let cases = [
        (
            r#"{"type":"run_started","runId":"r","trigger":"prompt","extra":1}"#,
            "unknown field `extra`",
        ),
        (
            r#"{"type":"run_paused","runId":"r"}"#,
            "unknown variant `run_paused`",
        ),
        (
            r#"{"runId":"r","trigger":"prompt"}"#,
            "missing field `type`",
        ),
        (
            r#"{"type":"run_started","runId":"r","trigger":"later"}"#,
            "unknown variant `later`",
        ),
        (
            r#"{"type":"tool_updated","toolCallId":"t","update":{"kind":"progress","message":"m","x":1}}"#,
            "unknown field `x`",
        ),
        (
            r#"{"type":"tool_updated","toolCallId":"t","update":{"kind":"paused"}}"#,
            "unknown variant `paused`",
        ),
        (r#"{"type":"retry_finished"}"#, "missing field `succeeded`"),
        (
            r#"{"type":"retry_scheduled","attempt":1.5,"message":"m"}"#,
            "invalid type: floating point `1.5`, expected i64",
        ),
    ];
    for (text, expected) in cases {
        let error = error_of(text);
        assert!(error.contains(expected), "{text}: {error}");
    }
}

#[test]
fn an_optional_field_is_absent_never_null() {
    let error = error_of(r#"{"type":"tool_started","toolCallId":"t","name":"ls","title":null}"#);
    assert!(
        error.contains("invalid type: null, expected a string"),
        "{error}"
    );

    let absent = r#"{"type":"tool_started","toolCallId":"t","name":"ls"}"#;
    let event: AgentEvent = serde_json::from_str(absent).unwrap();
    assert_eq!(serde_json::to_string(&event).unwrap(), absent);
}

/// `null` is a JSON value, so zod's optional `JsonValue` takes it, and so does the model.
#[test]
fn an_optional_json_value_takes_null_as_a_value() {
    let text = r#"{"type":"tool_started","toolCallId":"t","name":"ls","input":null}"#;
    let event: AgentEvent = serde_json::from_str(text).unwrap();
    let AgentEvent::ToolStarted(ToolStartedEvent { input, .. }) = &event else {
        panic!("{event:?}");
    };
    assert_eq!(input, &Some(JsonValue::Null));
    assert_eq!(serde_json::to_string(&event).unwrap(), text);
}

/// The one place the models are looser than zod: serde reads a struct from a JSON array too, field by field in
/// declaration order, and a union from one whose first element is the tag. The bridge never writes either and the
/// models do not wrap serde to refuse them (contract README §3); this pins the gap, so closing it shows.
#[test]
fn a_struct_is_also_read_from_a_json_array_in_field_order() {
    let session: SessionRef = serde_json::from_str(r#"["claude-code","s1"]"#).unwrap();
    assert_eq!(session.session_id, "s1");

    let frame = r#"["contract",{"type":"session.detach.result","requestId":"r"}]"#;
    assert!(decode_frame(frame).is_ok());

    let event: AgentEvent = serde_json::from_str(r#"["run_started","r","prompt"]"#).unwrap();
    assert!(matches!(event, AgentEvent::RunStarted(_)));
}
