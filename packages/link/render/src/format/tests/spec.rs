//! The official examples: every example of the CommonMark 0.31.2 spec and every GitHub extension
//! example (GFM 0.29: tables, task lists, strikethrough, extended autolinks, tag filter), parsed
//! by the formatter and written back as HTML by `html.rs`. Each passes, or is in `DIFFERENCES`
//! with the reason Broski reads it differently on purpose; a listed example that starts to pass
//! fails the test too, so the list stays true.

use std::collections::BTreeMap;

use serde_json::Value;

use super::html::html;
use crate::format::format_markdown;

const COMMONMARK: &str = include_str!("../../../tests/fixtures/spec/commonmark-0.31.2.json");
const GFM: &str = include_str!("../../../tests/fixtures/spec/gfm-0.29-extensions.json");

/// Examples Broski reads differently on purpose, by spec and example number.
const DIFFERENCES: &[(&str, u64, &str)] = &[
    ("commonmark", 356, ARITHMETIC),
    ("commonmark", 369, NESTED_EMPHASIS),
    ("commonmark", 373, NESTED_EMPHASIS),
    ("commonmark", 389, NESTED_EMPHASIS),
    ("commonmark", 407, NESTED_EMPHASIS),
    ("commonmark", 408, NESTED_EMPHASIS),
    ("commonmark", 409, NESTED_EMPHASIS),
    ("commonmark", 417, NESTED_EMPHASIS),
    ("commonmark", 418, NESTED_EMPHASIS),
    ("commonmark", 419, NESTED_EMPHASIS),
    ("commonmark", 425, NESTED_EMPHASIS),
    ("commonmark", 426, NESTED_EMPHASIS),
    ("commonmark", 427, NESTED_EMPHASIS),
    ("commonmark", 432, NESTED_EMPHASIS),
    ("commonmark", 461, NESTED_EMPHASIS),
    ("commonmark", 463, NESTED_EMPHASIS),
    ("commonmark", 464, NESTED_EMPHASIS),
    ("commonmark", 465, NESTED_EMPHASIS),
    ("commonmark", 466, NESTED_EMPHASIS),
    ("commonmark", 468, NESTED_EMPHASIS),
    ("commonmark", 484, EMPTY_LINK),
    ("commonmark", 487, EMPTY_LINK),
    ("commonmark", 517, IMAGE_IN_LINK),
    ("commonmark", 531, IMAGE_IN_LINK),
    ("gfm", 652, TAG_FILTER),
];

const ARITHMETIC: &str = "a single `*` between two digits is arithmetic (`2*3*4`), not emphasis";
const NESTED_EMPHASIS: &str =
    "emphasis inside emphasis of the same kind draws as one level: text is italic or not, bold or not";
const EMPTY_LINK: &str = "a link with no text has nothing to draw or tap, so it is left out";
const IMAGE_IN_LINK: &str =
    "an image inside a link keeps only the image: the phone draws an image as a chip that opens it";
const TAG_FILTER: &str =
    "no HTML is ever run, so GitHub's tag filter has nothing to filter: raw HTML stays as written";

struct Example {
    spec: &'static str,
    number: u64,
    section: String,
    markdown: String,
    html: String,
}

fn examples(spec: &'static str, json: &str) -> Vec<Example> {
    let parsed: Vec<Value> = serde_json::from_str(json).expect("the fixture is JSON");
    parsed
        .into_iter()
        .map(|example| Example {
            spec,
            number: example["example"].as_u64().unwrap_or_default(),
            section: example["section"].as_str().unwrap_or_default().to_owned(),
            markdown: example["markdown"].as_str().unwrap_or_default().to_owned(),
            html: example["html"].as_str().unwrap_or_default().to_owned(),
        })
        .collect()
}

/// Hard and soft line breaks are both kept as line breaks (agents write lines meant to stay
/// lines), so the reference's `<br />` reads as the line break it is.
fn normalized(html: &str) -> String {
    html.replace("<br />\n", "\n")
}

#[test]
fn every_official_example_passes_or_is_a_listed_difference() {
    let all: Vec<Example> = examples("commonmark", COMMONMARK)
        .into_iter()
        .chain(examples("gfm", GFM))
        .collect();
    let listed: BTreeMap<(&str, u64), &str> = DIFFERENCES
        .iter()
        .map(|(spec, number, reason)| ((*spec, *number), *reason))
        .collect();
    let mut unexpected = Vec::new();
    let mut stale = Vec::new();
    let mut passed = 0;
    for example in &all {
        let blocks = format_markdown(&example.markdown, false);
        let ours = html(&blocks, example.spec == "gfm");
        let pass = normalized(&ours) == normalized(&example.html);
        let known = listed.contains_key(&(example.spec, example.number));
        passed += usize::from(pass);
        if !pass && !known {
            unexpected.push(format!(
                "{} {} ({})\n--- markdown\n{}--- expected\n{}--- ours\n{}",
                example.spec, example.number, example.section, example.markdown, example.html, ours
            ));
        }
        if pass && known {
            stale.push(format!("{} {}", example.spec, example.number));
        }
    }
    println!(
        "{passed} of {} official examples pass; {} listed differences",
        all.len(),
        DIFFERENCES.len()
    );
    assert!(
        unexpected.is_empty(),
        "{} examples fail unlisted:\n\n{}",
        unexpected.len(),
        unexpected.join("\n")
    );
    assert!(stale.is_empty(), "listed but passing: {stale:?}");
}
