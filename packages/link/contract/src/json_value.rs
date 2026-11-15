use std::collections::HashMap;
use std::fmt;

use serde::de::{MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Any JSON: the contract's one open type (`json.ts`), for tool input and the like. A number is an
/// `f64`, as JavaScript holds it, and an object keeps its members in the order the bridge wrote them.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(Vec<JsonMember>),
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct JsonMember {
    pub key: String,
    pub value: JsonValue,
}

/// The largest integer a JavaScript number holds exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

impl Serialize for JsonValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            JsonValue::Null => serializer.serialize_unit(),
            JsonValue::Bool(value) => serializer.serialize_bool(*value),
            // A whole number goes out as an integer, as `JSON.stringify` writes it, so it also decodes
            // into an integer field.
            JsonValue::Number(value) if value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER => {
                serializer.serialize_i64(*value as i64)
            }
            JsonValue::Number(value) => serializer.serialize_f64(*value),
            JsonValue::String(value) => serializer.serialize_str(value),
            JsonValue::Array(items) => serializer.collect_seq(items),
            JsonValue::Object(members) => {
                serializer.collect_map(members.iter().map(|member| (&member.key, &member.value)))
            }
        }
    }
}

impl<'de> Deserialize<'de> for JsonValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(JsonValueVisitor)
    }
}

struct JsonValueVisitor;

impl<'de> Visitor<'de> for JsonValueVisitor {
    type Value = JsonValue;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_unit<E>(self) -> Result<JsonValue, E> {
        Ok(JsonValue::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<JsonValue, E> {
        Ok(JsonValue::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<JsonValue, E> {
        Ok(JsonValue::Number(value as f64))
    }

    fn visit_u64<E>(self, value: u64) -> Result<JsonValue, E> {
        Ok(JsonValue::Number(value as f64))
    }

    fn visit_f64<E>(self, value: f64) -> Result<JsonValue, E> {
        Ok(JsonValue::Number(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<JsonValue, E> {
        Ok(JsonValue::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<JsonValue, E> {
        Ok(JsonValue::String(value))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<JsonValue, A::Error> {
        let mut items = Vec::with_capacity(seq.size_hint().unwrap_or(0));
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(JsonValue::Array(items))
    }

    /// A repeated key keeps its first place and takes the last value, as `JSON.parse` does.
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<JsonValue, A::Error> {
        let mut members: Vec<JsonMember> = Vec::new();
        let mut places = HashMap::new();
        while let Some((key, value)) = map.next_entry::<String, JsonValue>()? {
            match places.get(&key) {
                Some(&place) => members[place] = JsonMember { key, value },
                None => {
                    places.insert(key.clone(), members.len());
                    members.push(JsonMember { key, value });
                }
            }
        }
        Ok(JsonValue::Object(members))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> JsonValue {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn keeps_member_order_and_resolves_a_repeated_key_as_json_parse_does() {
        let value = parse(r#"{"b":1,"a":2,"b":3}"#);
        assert_eq!(serde_json::to_string(&value).unwrap(), r#"{"b":3,"a":2}"#);
    }

    #[test]
    fn writes_safe_whole_numbers_as_integers_and_keeps_every_number_exact() {
        let value = parse("[1.0, -0.0, 2.5, 9007199254740993, 1e300]");
        let text = serde_json::to_string(&value).unwrap();
        assert!(text.starts_with("[1,0,2.5,"), "{text}");
        assert_eq!(parse(&text), value);
    }
}
