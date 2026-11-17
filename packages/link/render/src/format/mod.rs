//! Broski's own formatter: the agent's markdown as the phone draws it, a flat list of keyed blocks
//! of styled spans, so a SwiftUI `ForEach` or a Compose `LazyColumn` lays it out with no recursion.
//! No markdown library: the parser is this module's.
//!
//! **Streaming.** A block's `key` is its kind and the byte offset its source starts at, which text
//! appended later cannot move, so while the chat parses a growing message on every batch, every
//! block but the last keeps its key and only the last redraws. `streaming` says the text is still
//! arriving: markup left open at its very end is closed rather than shown as written.

mod blocks;
mod inline;
mod samples;
#[cfg(test)]
mod tests;

pub use samples::{format_samples, FormatSample};

use crate::prefix;

/// The text parsed: the contract's `MAX_TEXT_CHARS`, the most one block of an agent's text holds.
/// Past it the rest is one plain paragraph.
pub const MAX_FORMAT_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatBlock {
    /// The block's identity while the text grows: its kind and where its source starts.
    pub key: String,
    pub content: FormatContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatContent {
    /// Text whose line breaks are kept as written.
    Paragraph { spans: Vec<FormatSpan> },
    /// A fenced code block. `language` is the fence's first word as written (`ts`), the label to
    /// show and the language to hand `highlight`; `closed` is false while its closing fence has not
    /// arrived, which a streaming message's last block often is.
    Code {
        language: Option<String>,
        text: String,
        closed: bool,
    },
}

/// Text in one style; neighbouring spans always differ in style.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatSpan {
    pub text: String,
    pub code: bool,
}

/// `text` as blocks to lay out in order.
pub fn format_markdown(text: &str, streaming: bool) -> Vec<FormatBlock> {
    let parsed = prefix(text, MAX_FORMAT_BYTES);
    let mut formatted = blocks::blocks(parsed, streaming && parsed.len() == text.len());
    let rest = &text[parsed.len()..];
    if !rest.is_empty() {
        formatted.push(FormatBlock {
            key: format!("rest-{}", parsed.len()),
            content: FormatContent::Paragraph {
                spans: vec![FormatSpan {
                    text: rest.to_owned(),
                    code: false,
                }],
            },
        });
    }
    formatted
}
