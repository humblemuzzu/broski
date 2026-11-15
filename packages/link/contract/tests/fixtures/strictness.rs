//! The models decode as strictly as the zod schemas parse: what zod refuses, they refuse.

use broski_contract::{AgentEvent, JsonValue, ToolStartedEvent};

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
