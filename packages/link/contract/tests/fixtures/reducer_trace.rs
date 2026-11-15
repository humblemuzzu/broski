use broski_contract::{apply_event, session_status, AgentEvent, SessionSnapshot, Timestamp};
use serde::Deserialize;

use crate::canonical::{canonical_json, sha256_hex};
use crate::support::{decode, encode, expand_long_strings, field, fixture, items, member, string};

/// One step's input: the event and when the bridge recorded it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    at: Timestamp,
    event: AgentEvent,
}

#[test]
fn every_step_leaves_the_snapshot_and_status_the_typescript_reducer_left() {
    let trace = fixture("reducer_trace.json");
    for case in items(field(&trace, "cases")) {
        let name = string(field(case, "name"));
        let mut snapshot: SessionSnapshot =
            decode(&expand_long_strings(field(case, "initial"))).unwrap();
        for (index, step) in items(field(case, "steps")).iter().enumerate() {
            let place = format!("{name}, step {index}");
            let record: Record = decode(&expand_long_strings(field(step, "record")))
                .unwrap_or_else(|error| panic!("{place}: {error}"));
            apply_event(&mut snapshot, record.at, record.event);
            let status = encode(&session_status(&snapshot));
            assert_eq!(string(&status), string(field(step, "status")), "{place}");
            let actual = canonical_json(&encode(&snapshot));
            match (member(step, "expected"), member(step, "expectedSha256")) {
                (Some(expected), None) => {
                    let expected = canonical_json(&expand_long_strings(expected));
                    assert!(
                        actual == expected,
                        "{place}: {}",
                        difference(&actual, &expected)
                    );
                }
                (None, Some(hash)) => assert_eq!(sha256_hex(&actual), string(hash), "{place}"),
                _ => panic!("{place}: a step expects either a snapshot or its hash"),
            }
        }
    }
}

/// Where two snapshots part, without printing a megabyte of text that both hold.
fn difference(actual: &str, expected: &str) -> String {
    let start = actual
        .char_indices()
        .zip(expected.chars())
        .find(|((_, a), b)| a != b)
        .map_or(actual.len().min(expected.len()), |((index, _), _)| index);
    let around = |text: &str| {
        let from = text.floor_char_boundary(start.saturating_sub(80));
        text[from..].chars().take(240).collect::<String>()
    };
    format!(
        "they part at byte {start}\n  actual:   …{}\n  expected: …{}",
        around(actual),
        around(expected)
    )
}
