//! What the iOS and Android apps draw identically, computed once in Rust: the agent's markdown as
//! keyed blocks of styled spans (Broski's own formatter, `format`), code as lines of spans tagged
//! by token kind, diffs as files, hunks and lines with the changed words marked, how a tool
//! call reads in the work fold and an activity in the transcript, and long text cut to what a row
//! shows. The apps only map these to
//! `AttributedString` or `AnnotatedString` and colour them by their own light and dark palettes.
//!
//! Every function is pure and bounded: input past a stated size is passed through plainly, never
//! parsed, so no call can take unbounded time or memory. No UniFFI dependency: the facade
//! (`broski-mobile`) restates these types.

pub mod activity;
pub mod diff;
pub mod format;
pub mod highlight;
pub mod text;
pub mod work;

pub use activity::{activity_look, ActivityLook, ActivityTone, LOG_LINES};

pub use diff::{
    file_change_diff, git_diff_file, parse_unified_diff, side_by_side, DiffFile, DiffHunk,
    DiffLine, DiffLineKind, DiffSegment, ParsedDiff, SideBySideRow,
};
pub use format::{
    format_json, format_markdown, format_message, format_plain_text, format_samples, json_lines,
    table_csv, table_html, table_markdown, table_tsv, CalloutKind, ColumnAlign, ContainerKind,
    FormatBlock, FormatCode, FormatContainer, FormatContent, FormatLink, FormatSample,
    FormatSpacing, FormatSpan, FormatTable, LinkKind, ListMarker, TableCell, TableColumn,
    TableShape, TextDirection, MAX_FORMAT_BYTES, MAX_JSON_BYTES,
};
pub use highlight::{
    highlight, language_for_path, language_label, normalize_language, CodeLine, CodeSpan, TokenKind,
};
pub use text::{clip_text, format_duration, opening_words, ClipEnd, TextClip, MAX_CLIP_BYTES};

pub use work::{
    fold_counts, format_log, tool_arguments, tool_body, tool_kind, tool_look, ArgumentValue,
    FoldCount, FoldTool, FoldVerb, LogLine, LogText, MatchRow, MatchSegment, ToolArgument,
    ToolBody, ToolFacts, ToolKind, ToolLook, TOOL_LOG_LINES,
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
