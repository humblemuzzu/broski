//! Broski's own formatter: the agent's markdown as the phone draws it, a flat list of keyed blocks
//! of styled spans, so a SwiftUI `ForEach` or a Compose `LazyColumn` lays it out with no recursion.
//! No markdown library: the parser is this module's. It follows CommonMark 0.31.2 and GitHub's
//! extensions (tables, strikethrough, task lists, extended autolinks, alerts, footnotes), plus TeX
//! math and Claude Code's insight block; `tests/spec.rs` holds it to the official examples.
//!
//! **Streaming.** A block's `key` is its kind and the byte offset its source starts at, which text
//! appended later cannot move, so while the chat parses a growing message on every batch, every
//! block but the last keeps its key and only the last redraws. `streaming` says the text is still
//! arriving: markup left open at its very end is closed or held back rather than shown as written.

mod block;
mod direction;
mod export;
mod flatten;
mod heal;
mod inline;
mod json;
mod leaves;
mod links;
mod message;
mod model;
mod samples;
mod tables;
#[cfg(test)]
mod tests;

pub(crate) use export::plain_text;
pub use export::{format_plain_text, table_csv, table_html, table_markdown, table_tsv};
pub(crate) use inline::linked_text;
pub(crate) use json::number_text;
pub use json::{format_json, json_lines, MAX_JSON_BYTES};
pub(crate) use links::is_path;
pub use message::format_message;
pub use model::{
    CalloutKind, ColumnAlign, ContainerKind, FormatBlock, FormatCode, FormatContainer,
    FormatContent, FormatLink, FormatSpacing, FormatSpan, FormatTable, LinkKind, ListMarker,
    TableCell, TableColumn, TableShape, TextDirection,
};
pub use samples::{format_samples, FormatSample};

use crate::prefix;

/// The text parsed: the contract's `MAX_TEXT_CHARS`, the most one block of an agent's text holds.
/// Past it the rest is one plain paragraph.
pub const MAX_FORMAT_BYTES: usize = 1_048_576;

/// `text` as blocks to lay out in order.
pub fn format_markdown(text: &str, streaming: bool) -> Vec<FormatBlock> {
    let parsed = prefix(text, MAX_FORMAT_BYTES);
    let streaming = streaming && parsed.len() == text.len();
    let source = if streaming {
        heal::hold_back(parsed)
    } else {
        parsed
    };
    let tree = block::parse(source, streaming);
    let mut formatted = flatten::blocks(&tree, streaming);
    let rest = &text[parsed.len()..];
    if !rest.is_empty() {
        formatted.push(FormatBlock {
            key: format!("rest-{}", parsed.len()),
            containers: Vec::new(),
            spacing: FormatSpacing::Paragraph,
            direction: TextDirection::LeftToRight,
            content: FormatContent::Paragraph {
                spans: vec![FormatSpan {
                    text: rest.to_owned(),
                    ..FormatSpan::default()
                }],
            },
        });
    }
    formatted
}
