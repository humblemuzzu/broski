//! Assistant markdown as the chat draws it: a flat list of blocks, each with the quotes and list
//! items it sits in and its text as styled runs, so a SwiftUI `ForEach` or a Compose `LazyColumn`
//! lays it out with no recursion.
//!
//! **Streaming.** The chat parses the open text block again on every batch. A block's `key` is its
//! kind and the byte offset its source starts at, which text appended later cannot move, so every
//! block but the last keeps its key. Only the last block's content changes, and the one before it
//! when the new text joins it (a table's next row, a paragraph's lazy continuation line), which
//! briefly read as a block of its own.

#[cfg(test)]
mod tests;
mod walk;

use crate::prefix;

/// The text parsed: the contract's `MAX_TEXT_CHARS`, the most one block of an agent's text holds.
/// Past it the rest is one plain paragraph.
pub const MAX_MARKDOWN_BYTES: usize = 1_048_576;

/// Containers a block lists; deeper quotes and list items are left out of its path (its text is
/// kept).
pub const MAX_CONTAINER_DEPTH: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownBlock {
    /// The block's identity while the text grows: its kind and where its source starts.
    pub key: String,
    /// The block quotes and list items around the block, outermost first.
    pub containers: Vec<BlockContainer>,
    pub content: BlockContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockContainer {
    Quote,
    /// One list item. Only its first block shows the marker (`first`); the item's later blocks
    /// are indented under it.
    ListItem {
        marker: ListMarker,
        first: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListMarker {
    Bullet,
    /// An ordered list's number for this item, counted from the list's start.
    Number {
        value: u64,
    },
    /// A GitHub task list item, ordered or not.
    Task {
        checked: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockContent {
    Paragraph {
        runs: Vec<InlineRun>,
    },
    /// `level` 1 to 6.
    Heading {
        level: u8,
        runs: Vec<InlineRun>,
    },
    /// A fenced or indented code block. `language` is the fence's first word as written (`ts`,
    /// `bash`), the label to show and the language to hand `highlight`.
    Code {
        language: Option<String>,
        text: String,
    },
    /// Every row has one cell per column of `alignments`.
    Table {
        alignments: Vec<ColumnAlignment>,
        header: TableRow,
        rows: Vec<TableRow>,
    },
    Rule,
    /// An HTML block, shown as the literal text it is.
    Html {
        text: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCell {
    pub runs: Vec<InlineRun>,
}

/// A column with no alignment of its own is `Leading`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnAlignment {
    Leading,
    Center,
    Trailing,
}

/// Text in one style. Neighbouring runs always differ in style. A soft line break is a space, a
/// hard one `\n`; an image is its alt text linking to the image; inline HTML is literal text. A
/// `link` is only ever an `http`, `https` or `mailto` URL; any other destination leaves plain text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineRun {
    pub text: String,
    pub strong: bool,
    pub emphasis: bool,
    pub strikethrough: bool,
    pub code: bool,
    pub link: Option<String>,
}

impl InlineRun {
    fn plain(text: &str) -> InlineRun {
        InlineRun {
            text: text.to_owned(),
            strong: false,
            emphasis: false,
            strikethrough: false,
            code: false,
            link: None,
        }
    }
}

/// `text` as blocks: CommonMark with GitHub's tables, strikethrough and task lists. Autolinks are
/// CommonMark's (`<https://…>`); a bare URL stays text.
pub fn markdown_blocks(text: &str) -> Vec<MarkdownBlock> {
    let parsed = prefix(text, MAX_MARKDOWN_BYTES);
    let mut blocks = walk::blocks(parsed);
    let rest = &text[parsed.len()..];
    if !rest.is_empty() {
        blocks.push(MarkdownBlock {
            key: format!("rest-{}", parsed.len()),
            containers: Vec::new(),
            content: BlockContent::Paragraph {
                runs: vec![InlineRun::plain(rest)],
            },
        });
    }
    blocks
}
