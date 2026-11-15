use serde::{Deserialize, Deserializer};

/// Reads an optional field that is present; `#[serde(default)]` makes an absent one `None`. `null` is
/// refused, as the zod schemas refuse it, unless `null` is a value of the field's own type: an optional
/// `JsonValue` that is `null` is `Some(JsonValue::Null)`, as it is in TypeScript.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
