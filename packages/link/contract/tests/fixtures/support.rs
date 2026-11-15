use std::path::PathBuf;

use broski_contract::{JsonMember, JsonValue, Tagged};
use serde::de::DeserializeOwned;
use serde::Serialize;

/// A fixture as the bridge wrote it, read where it lives rather than copied.
pub fn fixture(name: &str) -> JsonValue {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../bridge/contract-fixtures")
        .join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

pub fn member<'a>(value: &'a JsonValue, key: &str) -> Option<&'a JsonValue> {
    match value {
        JsonValue::Object(members) => members
            .iter()
            .find(|member| member.key == key)
            .map(|member| &member.value),
        _ => None,
    }
}

pub fn field<'a>(value: &'a JsonValue, key: &str) -> &'a JsonValue {
    member(value, key).unwrap_or_else(|| panic!("no {key} in {}", text_of(value)))
}

pub fn items(value: &JsonValue) -> &[JsonValue] {
    match value {
        JsonValue::Array(items) => items,
        other => panic!("not a list: {}", text_of(other)),
    }
}

pub fn members(value: &JsonValue) -> &[JsonMember] {
    match value {
        JsonValue::Object(members) => members,
        other => panic!("not an object: {}", text_of(other)),
    }
}

pub fn string(value: &JsonValue) -> &str {
    match value {
        JsonValue::String(text) => text,
        other => panic!("not a string: {}", text_of(other)),
    }
}

pub fn text_of(value: &JsonValue) -> String {
    serde_json::to_string(value).unwrap()
}

/// The fixture key that stands for a long string (`fixture-text.ts`): `{"$runs": [[codePoint, count], …]}`.
const RUNS_KEY: &str = "$runs";

/// `value` with every long string written back out of its runs.
pub fn expand_long_strings(value: &JsonValue) -> JsonValue {
    match value {
        JsonValue::Array(items) => {
            JsonValue::Array(items.iter().map(expand_long_strings).collect())
        }
        JsonValue::Object(_) if member(value, RUNS_KEY).is_some() => {
            let runs = items(field(value, RUNS_KEY))
                .iter()
                .map(|run| match items(run) {
                    [JsonValue::String(code_point), JsonValue::Number(count)] => {
                        code_point.repeat(*count as usize)
                    }
                    _ => panic!("a run is [codePoint, count], not {}", text_of(run)),
                });
            JsonValue::String(runs.collect())
        }
        JsonValue::Object(entries) => JsonValue::Object(
            entries
                .iter()
                .map(|entry| JsonMember {
                    key: entry.key.clone(),
                    value: expand_long_strings(&entry.value),
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Decodes as the phone does, from JSON text.
pub fn decode<T: DeserializeOwned>(value: &JsonValue) -> Result<T, serde_json::Error> {
    serde_json::from_str(&text_of(value))
}

pub fn encode<T: Serialize>(value: &T) -> JsonValue {
    serde_json::from_str(&serde_json::to_string(value).unwrap()).unwrap()
}

/// A union member decoded on its own, carrying its tag.
pub fn decode_tagged<T: Tagged + DeserializeOwned>(
    value: &JsonValue,
) -> Result<T, serde_json::Error> {
    let text = text_of(value);
    broski_contract::tagged::deserialize(&mut serde_json::Deserializer::from_str(&text))
}

pub fn encode_tagged<T: Tagged + Serialize>(value: &T) -> JsonValue {
    let mut text = Vec::new();
    broski_contract::tagged::serialize(value, &mut serde_json::Serializer::new(&mut text)).unwrap();
    serde_json::from_slice(&text).unwrap()
}
