//! A union member on its own, as `AttachmentRead.image` holds an `ImageContent`. Inside its union serde
//! writes and checks the member's tag, so the struct has no tag field; a field that holds the struct
//! directly goes through this module (`#[serde(with = "crate::tagged")]`), which does the same.

use std::fmt;
use std::marker::PhantomData;

use serde::de::{self, DeserializeSeed, IntoDeserializer, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The tag a union member carries: `KEY` is its unions' discriminator, `TAG` this member's value of it.
pub trait Tagged {
    const KEY: &'static str;
    const TAG: &'static str;
}

pub fn serialize<T, S>(value: &T, serializer: S) -> Result<S::Ok, S::Error>
where
    T: Tagged + Serialize,
    S: Serializer,
{
    WithTag {
        tag: Tag(PhantomData::<T>),
        value,
    }
    .serialize(serializer)
}

/// Strict as the union is: the tag is required, once, with this member's value, and the struct's own
/// rules (no unknown field) hold for the rest.
pub fn deserialize<'de, T, D>(deserializer: D) -> Result<T, D::Error>
where
    T: Tagged + Deserialize<'de>,
    D: Deserializer<'de>,
{
    T::deserialize(TagChecked {
        inner: deserializer,
        member: PhantomData::<T>,
    })
}

/// The same for an optional field, which serde reaches only when the field is present.
pub mod option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    use super::Tagged;

    pub fn serialize<T, S>(value: &Option<T>, serializer: S) -> Result<S::Ok, S::Error>
    where
        T: Tagged + Serialize,
        S: Serializer,
    {
        match value {
            Some(value) => super::serialize(value, serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
    where
        T: Tagged + Deserialize<'de>,
        D: Deserializer<'de>,
    {
        super::deserialize(deserializer).map(Some)
    }
}

#[derive(Serialize)]
#[serde(bound = "T: Tagged + Serialize")]
struct WithTag<'a, T> {
    #[serde(flatten)]
    tag: Tag<T>,
    #[serde(flatten)]
    value: &'a T,
}

struct Tag<T>(PhantomData<T>);

impl<T: Tagged> Serialize for Tag<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry(T::KEY, T::TAG)?;
        map.end()
    }
}

/// Hands the struct's visitor the object without its tag, having checked the tag on the way.
struct TagChecked<D, T> {
    inner: D,
    member: PhantomData<T>,
}

impl<'de, D: Deserializer<'de>, T: Tagged> Deserializer<'de> for TagChecked<D, T> {
    type Error = D::Error;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
        self.inner.deserialize_map(TagStripped {
            visitor,
            member: self.member,
        })
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf option
        unit unit_struct newtype_struct seq tuple tuple_struct map struct enum identifier ignored_any
    }
}

struct TagStripped<V, T> {
    visitor: V,
    member: PhantomData<T>,
}

impl<'de, V: Visitor<'de>, T: Tagged> Visitor<'de> for TagStripped<V, T> {
    type Value = V::Value;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        self.visitor.expecting(formatter)
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<V::Value, A::Error> {
        self.visitor.visit_map(TagFilter {
            map,
            seen: false,
            member: self.member,
        })
    }
}

struct TagFilter<A, T> {
    map: A,
    seen: bool,
    member: PhantomData<T>,
}

impl<'de, A: MapAccess<'de>, T: Tagged> MapAccess<'de> for TagFilter<A, T> {
    type Error = A::Error;

    fn next_key_seed<K: DeserializeSeed<'de>>(
        &mut self,
        seed: K,
    ) -> Result<Option<K::Value>, A::Error> {
        while let Some(key) = self.map.next_key::<String>()? {
            if key != T::KEY {
                return seed.deserialize(key.into_deserializer()).map(Some);
            }
            if self.seen {
                return Err(de::Error::duplicate_field(T::KEY));
            }
            let tag: String = self.map.next_value()?;
            if tag != T::TAG {
                return Err(de::Error::invalid_value(de::Unexpected::Str(&tag), &T::TAG));
            }
            self.seen = true;
        }
        if self.seen {
            Ok(None)
        } else {
            Err(de::Error::missing_field(T::KEY))
        }
    }

    fn next_value_seed<S: DeserializeSeed<'de>>(&mut self, seed: S) -> Result<S::Value, A::Error> {
        self.map.next_value_seed(seed)
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use crate::{ImageContent, Tagged};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Holder {
        #[serde(with = "crate::tagged")]
        image: ImageContent,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[serde(with = "crate::tagged::option")]
        spare: Option<ImageContent>,
    }

    const IMAGE: &str = r#"{"kind":"image","mimeType":"image/png","data":"AA=="}"#;

    fn decode(text: &str) -> Result<Holder, String> {
        serde_json::from_str(text).map_err(|error| error.to_string())
    }

    #[test]
    fn writes_the_tag_first_and_reads_it_back() {
        let holder = decode(&format!(r#"{{"image":{IMAGE},"spare":{IMAGE}}}"#)).unwrap();
        let text = serde_json::to_string(&holder).unwrap();
        assert_eq!(text, format!(r#"{{"image":{IMAGE},"spare":{IMAGE}}}"#));
        assert_eq!(
            decode(&format!(r#"{{"image":{IMAGE}}}"#)).unwrap().spare,
            None
        );
        assert_eq!(ImageContent::TAG, "image");
    }

    #[test]
    fn refuses_a_missing_wrong_or_repeated_tag_and_an_unknown_field() {
        let cases = [
            (
                r#"{"mimeType":"image/png","data":"AA=="}"#,
                "missing field `kind`",
            ),
            (
                r#"{"kind":"file","mimeType":"image/png","data":"AA=="}"#,
                "invalid value",
            ),
            (
                r#"{"kind":"image","kind":"image","mimeType":"image/png","data":"AA=="}"#,
                "duplicate field `kind`",
            ),
            (
                r#"{"kind":"image","mimeType":"image/png","data":"AA==","x":1}"#,
                "unknown field `x`",
            ),
            (r#"["image","image/png","AA=="]"#, "invalid type: sequence"),
        ];
        for (image, expected) in cases {
            let error = decode(&format!(r#"{{"image":{image}}}"#)).unwrap_err();
            assert!(error.contains(expected), "{image}: {error}");
        }
        let error = decode(&format!(r#"{{"image":{IMAGE},"spare":null}}"#)).unwrap_err();
        assert!(error.contains("invalid type: null"), "{error}");
    }
}
