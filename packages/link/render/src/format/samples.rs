//! The formatting gallery's corpus: real-shaped agent text with every edge case the formatter must
//! draw well, from `render/tests/fixtures/format/`. Both apps list these on a screen of their own,
//! so the formatting is judged on the phone, at every size, in both appearances.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatSample {
    pub title: String,
    pub text: String,
    /// The text stops mid-message, so it is drawn as still arriving.
    pub arriving: bool,
}

const SAMPLES: [(&str, &str, bool); 17] = [
    (
        "Written for the phone",
        include_str!("../../tests/fixtures/format/16-phone-answer.md"),
        false,
    ),
    (
        "A long explainer",
        include_str!("../../tests/fixtures/format/17-long-explainer.md"),
        false,
    ),
    (
        "Written for a terminal",
        include_str!("../../tests/fixtures/format/15-terminal-report.md"),
        false,
    ),
    (
        "An agent's answer",
        include_str!("../../tests/fixtures/format/01-agent-answer.md"),
        false,
    ),
    (
        "Tables",
        include_str!("../../tests/fixtures/format/02-tables.md"),
        false,
    ),
    (
        "Lists and tasks",
        include_str!("../../tests/fixtures/format/03-lists-and-tasks.md"),
        false,
    ),
    (
        "Quotes and callouts",
        include_str!("../../tests/fixtures/format/04-quotes-and-callouts.md"),
        false,
    ),
    (
        "Links and paths",
        include_str!("../../tests/fixtures/format/05-links-and-paths.md"),
        false,
    ),
    (
        "Code",
        include_str!("../../tests/fixtures/format/06-code.md"),
        false,
    ),
    (
        "Inline edge cases",
        include_str!("../../tests/fixtures/format/07-inline-edge-cases.md"),
        false,
    ),
    (
        "Thinking",
        include_str!("../../tests/fixtures/format/08-thinking.md"),
        false,
    ),
    (
        "A subagent's report",
        include_str!("../../tests/fixtures/format/09-subagent-report.md"),
        false,
    ),
    (
        "Languages and scripts",
        include_str!("../../tests/fixtures/format/10-languages.md"),
        false,
    ),
    (
        "Headings",
        include_str!("../../tests/fixtures/format/11-headings.md"),
        false,
    ),
    (
        "Cut mid-stream",
        include_str!("../../tests/fixtures/format/12-streaming-cut.md"),
        true,
    ),
    (
        "Big tables",
        include_str!("../../tests/fixtures/format/13-big-tables.md"),
        false,
    ),
    (
        "Agent quirks",
        include_str!("../../tests/fixtures/format/14-agent-quirks.md"),
        false,
    ),
];

pub fn format_samples() -> Vec<FormatSample> {
    SAMPLES
        .iter()
        .map(|(title, text, arriving)| FormatSample {
            title: (*title).to_owned(),
            text: (*text).to_owned(),
            arriving: *arriving,
        })
        .collect()
}
