use broski_contract::JsonValue;

use crate::generated::CONSTANTS;
use crate::support::{fixture, members, text_of};

/// The bounds the reducer and the client keep to are the bridge's own, every one of them.
#[test]
fn every_bound_is_the_bridge_s() {
    let fixture = fixture("constants.json");
    let bridge: Vec<(&str, f64)> = members(&fixture)
        .iter()
        .map(|entry| match entry.value {
            JsonValue::Number(value) => (entry.key.as_str(), value),
            _ => panic!("{} is not a number: {}", entry.key, text_of(&entry.value)),
        })
        .collect();
    let rust: Vec<(&str, f64)> = CONSTANTS
        .iter()
        .map(|&(name, value)| (name, value as f64))
        .collect();
    assert_eq!(rust, bridge);
}
