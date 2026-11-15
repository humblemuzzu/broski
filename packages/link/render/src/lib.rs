//! What the iOS and Android apps draw identically, computed once in Rust: assistant markdown as
//! flat blocks of styled runs, code as lines of spans tagged by token kind, and diffs as files,
//! hunks and lines with the changed words marked. The apps only map these to `AttributedString`
//! or `AnnotatedString` and colour them by their own light and dark palettes.
//!
//! Every function is pure and bounded: input past a stated size is passed through plainly, never
//! parsed, so no call can take unbounded time or memory. No UniFFI dependency: the facade
//! (`broski-mobile`) restates these types.

pub mod diff;
pub mod highlight;
pub mod markdown;

pub use diff::{
    file_change_diff, git_diff_file, parse_unified_diff, side_by_side, DiffFile, DiffHunk,
    DiffLine, DiffLineKind, DiffSegment, ParsedDiff, SideBySideRow,
};
pub use highlight::{
    highlight, language_for_path, normalize_language, CodeLine, CodeSpan, TokenKind,
};
pub use markdown::{
    markdown_blocks, BlockContainer, BlockContent, ColumnAlignment, InlineRun, ListMarker,
    MarkdownBlock, TableCell, TableRow,
};

/// The longest prefix of `text` of at most `max` bytes that ends on a character boundary.
fn prefix(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
