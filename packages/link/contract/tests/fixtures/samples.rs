use std::collections::BTreeSet;

use broski_contract::{JsonMember, JsonValue, Tagged};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::canonical::canonical_json;
use crate::generated::{visit_types, TypeVisitor};
use crate::support::{
    decode, decode_tagged, encode, encode_tagged, fixture, items, members, text_of,
};

/// Decodes every sample by its declared type and writes it back to the same JSON.
struct RoundTrip<'a> {
    samples: &'a [JsonMember],
    visited: BTreeSet<String>,
}

impl RoundTrip<'_> {
    fn samples_of(&mut self, name: &str) -> &[JsonValue] {
        assert!(self.visited.insert(name.to_owned()), "{name} visited twice");
        let samples = self.samples.iter().find(|entry| entry.key == name);
        items(
            &samples
                .unwrap_or_else(|| panic!("no samples of {name}"))
                .value,
        )
    }
}

impl TypeVisitor for RoundTrip<'_> {
    fn plain<T: Serialize + DeserializeOwned>(&mut self, name: &str) {
        for sample in self.samples_of(name) {
            let decoded: T = decode(sample)
                .unwrap_or_else(|error| panic!("{name} {}: {error}", text_of(sample)));
            assert_eq!(
                canonical_json(&encode(&decoded)),
                canonical_json(sample),
                "{name}"
            );
        }
    }

    fn tagged<T: Tagged + Serialize + DeserializeOwned>(&mut self, name: &str) {
        for sample in self.samples_of(name) {
            let decoded: T = decode_tagged(sample)
                .unwrap_or_else(|error| panic!("{name} {}: {error}", text_of(sample)));
            assert_eq!(
                canonical_json(&encode_tagged(&decoded)),
                canonical_json(sample),
                "{name}"
            );
        }
    }
}

#[test]
fn every_sample_of_every_type_decodes_by_its_type_and_encodes_back_unchanged() {
    let fixture = fixture("contract_samples.json");
    let samples = members(&fixture);
    let mut round_trip = RoundTrip {
        samples,
        visited: BTreeSet::new(),
    };
    visit_types(&mut round_trip);
    let named: BTreeSet<String> = samples.iter().map(|entry| entry.key.clone()).collect();
    assert_eq!(
        round_trip.visited, named,
        "the Rust types and the samples name the same types"
    );
}
