//! Canonical JSON as `scripts/contract-gen/canonical-json.ts` writes it: every object's keys in UTF-16
//! code-unit order, strings escaped and numbers printed as `JSON.stringify` does. The reducer trace
//! hashes a large snapshot as the SHA-256 of this text.

use std::cmp::Ordering;
use std::fmt::Write;

use broski_contract::JsonValue;
use sha2::{Digest, Sha256};

pub fn canonical_json(value: &JsonValue) -> String {
    let mut text = String::new();
    write_value(&mut text, value);
    text
}

pub fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .fold(String::new(), |mut hex, byte| {
            write!(hex, "{byte:02x}").unwrap();
            hex
        })
}

fn write_value(text: &mut String, value: &JsonValue) {
    match value {
        JsonValue::Null => text.push_str("null"),
        JsonValue::Bool(value) => text.push_str(if *value { "true" } else { "false" }),
        JsonValue::Number(value) => text.push_str(&js_number(*value)),
        JsonValue::String(value) => write_string(text, value),
        JsonValue::Array(items) => {
            text.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    text.push(',');
                }
                write_value(text, item);
            }
            text.push(']');
        }
        JsonValue::Object(members) => {
            let mut sorted: Vec<_> = members.iter().collect();
            sorted.sort_by(|a, b| by_code_units(&a.key, &b.key));
            text.push('{');
            for (index, member) in sorted.into_iter().enumerate() {
                if index > 0 {
                    text.push(',');
                }
                write_string(text, &member.key);
                text.push(':');
                write_value(text, &member.value);
            }
            text.push('}');
        }
    }
}

/// UTF-8 orders by code point, which differs from UTF-16 above U+FFFF.
fn by_code_units(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn write_string(text: &mut String, value: &str) {
    text.push('"');
    for character in value.chars() {
        match character {
            '"' => text.push_str("\\\""),
            '\\' => text.push_str("\\\\"),
            '\u{8}' => text.push_str("\\b"),
            '\u{c}' => text.push_str("\\f"),
            '\n' => text.push_str("\\n"),
            '\r' => text.push_str("\\r"),
            '\t' => text.push_str("\\t"),
            control if control < ' ' => write!(text, "\\u{:04x}", control as u32).unwrap(),
            other => text.push(other),
        }
    }
    text.push('"');
}

/// ECMAScript's Number::toString: the shortest digits that round-trip, which Rust's `{:e}` also gives,
/// laid out plainly between 1e-7 and 1e21 and in exponent form outside.
fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let digits = mantissa.replace('.', "");
    let count = digits.len() as i32;
    let point = exponent.parse::<i32>().unwrap() + 1;
    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat(-point as usize))
    } else {
        let exponent = point - 1;
        let exponent_sign = if exponent < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{fraction}e{exponent_sign}{}", exponent.abs())
    };
    format!("{sign}{body}")
}

#[test]
fn orders_every_key_by_code_units_integer_like_keys_too_at_any_depth() {
    // The TypeScript generator's own case (`contract_gen_fixtures.test.ts`), and a key above U+FFFF,
    // which sorts before U+FFFF in UTF-16 and after it in UTF-8.
    let value: JsonValue = serde_json::from_str(
        r#"{"10":1,"2":[{"z":1,"Z":null}],"a":{"é":true,"b":"x"},"\uffff":0,"😀":0}"#,
    )
    .unwrap();
    assert_eq!(
        canonical_json(&value),
        "{\"10\":1,\"2\":[{\"Z\":null,\"z\":1}],\"a\":{\"b\":\"x\",\"é\":true},\"😀\":0,\"\u{ffff}\":0}"
    );
}

#[test]
fn prints_numbers_and_strings_as_json_stringify_does() {
    // Each expected text is what Bun 1.4's JSON.stringify printed for the same value.
    let cases = [
        (0.1 + 0.2, "0.30000000000000004"),
        (1e21, "1e+21"),
        (1e20, "100000000000000000000"),
        (123456789012345680000.0, "123456789012345680000"),
        (1e-7, "1e-7"),
        (0.000001, "0.000001"),
        (-2.5e-8, "-2.5e-8"),
        (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (9007199254740992.0, "9007199254740992"),
        (-0.0, "0"),
        (100.0, "100"),
        (0.0125, "0.0125"),
        (12345.678, "12345.678"),
        (1.0 / 3.0, "0.3333333333333333"),
    ];
    for (number, expected) in cases {
        assert_eq!(canonical_json(&JsonValue::Number(number)), expected);
    }
    let text = JsonValue::String("a\"\\\u{8}\u{c}\n\r\t\u{1}\u{1f}\u{7f}\u{2028}é😀/".to_owned());
    assert_eq!(
        canonical_json(&text),
        "\"a\\\"\\\\\\b\\f\\n\\r\\t\\u0001\\u001f\u{7f}\u{2028}é😀/\""
    );
}
