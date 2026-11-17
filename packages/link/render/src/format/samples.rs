//! The formatting gallery's corpus: real-shaped agent text with every edge case the formatter must
//! draw well, from `render/tests/fixtures/format/`. Both apps list these on a screen of their own,
//! so the formatting is judged on the phone, at every size, in both appearances.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatSample {
    pub title: String,
    pub text: String,
}

const SAMPLES: [(&str, &str); 14] = [
    (
        "An agent's answer",
        include_str!("../../tests/fixtures/format/01-agent-answer.md"),
    ),
    (
        "Tables",
        include_str!("../../tests/fixtures/format/02-tables.md"),
    ),
    (
        "Lists and tasks",
        include_str!("../../tests/fixtures/format/03-lists-and-tasks.md"),
    ),
    (
        "Quotes and callouts",
        include_str!("../../tests/fixtures/format/04-quotes-and-callouts.md"),
    ),
    (
        "Links and paths",
        include_str!("../../tests/fixtures/format/05-links-and-paths.md"),
    ),
    (
        "Code",
        include_str!("../../tests/fixtures/format/06-code.md"),
    ),
    (
        "Inline edge cases",
        include_str!("../../tests/fixtures/format/07-inline-edge-cases.md"),
    ),
    (
        "Thinking",
        include_str!("../../tests/fixtures/format/08-thinking.md"),
    ),
    (
        "A subagent's report",
        include_str!("../../tests/fixtures/format/09-subagent-report.md"),
    ),
    (
        "Languages and scripts",
        include_str!("../../tests/fixtures/format/10-languages.md"),
    ),
    (
        "Headings",
        include_str!("../../tests/fixtures/format/11-headings.md"),
    ),
    (
        "Cut mid-stream",
        include_str!("../../tests/fixtures/format/12-streaming-cut.md"),
    ),
    (
        "Big tables",
        include_str!("../../tests/fixtures/format/13-big-tables.md"),
    ),
    (
        "Agent quirks",
        include_str!("../../tests/fixtures/format/14-agent-quirks.md"),
    ),
];

pub fn format_samples() -> Vec<FormatSample> {
    SAMPLES
        .iter()
        .map(|(title, text)| FormatSample {
            title: (*title).to_owned(),
            text: (*text).to_owned(),
        })
        .collect()
}
