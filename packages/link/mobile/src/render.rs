//! What both apps draw the same way (`broski-render`): code as coloured spans, diffs as lines. Pure functions of their input, callable without a `Phone` from any thread; for a
//! large file or diff, call them off the main thread.

use broski_contract::{FileChange, GitChange, GitDiffFile};
use broski_render::{
    CodeLine, CodeSpan, DiffFile, DiffHunk, DiffLine, DiffLineKind, DiffSegment, ParsedDiff,
    SideBySideRow, TokenKind,
};

/// `code` as lines of spans by token kind; an unknown or absent `language` is plain text.
/// `language` is a fence label (`ts`, `bash`) or what `languageForPath` returned.
#[uniffi::export]
pub fn highlight(code: String, language: Option<String>) -> Vec<CodeLine> {
    broski_render::highlight(&code, language.as_deref())
}

/// The language to highlight a file in, by its name or extension; `nil` to show it plainly.
#[uniffi::export]
pub fn language_for_path(path: String) -> Option<String> {
    broski_render::language_for_path(&path)
}

/// The language's name for a fence label (`ts` → `TypeScript`); `nil` when none is known.
#[uniffi::export]
pub fn normalize_language(label: String) -> Option<String> {
    broski_render::normalize_language(&label)
}

/// Unified diff text: `git diff`, `diff -u`, or bare hunks (one file with an empty path).
#[uniffi::export]
pub fn parse_unified_diff(text: String) -> ParsedDiff {
    broski_render::parse_unified_diff(&text)
}

/// A tool's file change (a `ToolResult`'s or a permission preview's `fileChanges`).
#[uniffi::export]
pub fn file_change_diff(change: FileChange) -> DiffFile {
    broski_render::file_change_diff(&change)
}

/// One file of a `git.diff` answer.
#[uniffi::export]
pub fn git_diff_file(file: GitDiffFile) -> DiffFile {
    broski_render::git_diff_file(&file)
}

/// A hunk's rows for a side-by-side view on a wide screen.
#[uniffi::export]
pub fn side_by_side(hunk: DiffHunk) -> Vec<SideBySideRow> {
    broski_render::side_by_side(&hunk)
}

#[uniffi::remote(Enum)]
pub enum TokenKind {
    Plain,
    Comment,
    Keyword,
    String,
    Number,
    Constant,
    Type,
    Function,
    Variable,
    Property,
    Operator,
    Punctuation,
    Tag,
    Attribute,
    Inserted,
    Deleted,
    Heading,
}

#[uniffi::remote(Record)]
pub struct CodeSpan {
    pub text: String,
    pub kind: TokenKind,
}

#[uniffi::remote(Record)]
pub struct CodeLine {
    pub spans: Vec<CodeSpan>,
}

#[uniffi::remote(Record)]
pub struct ParsedDiff {
    pub files: Vec<DiffFile>,
    pub truncated: bool,
}

#[uniffi::remote(Record)]
pub struct DiffFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub change: GitChange,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: i64,
    pub deletions: i64,
}

#[uniffi::remote(Record)]
pub struct DiffHunk {
    pub old_start: i64,
    pub old_lines: i64,
    pub new_start: i64,
    pub new_lines: i64,
    pub header: Option<String>,
    pub lines: Vec<DiffLine>,
}

#[uniffi::remote(Enum)]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
    NoNewline,
}

#[uniffi::remote(Record)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub text: String,
    pub segments: Vec<DiffSegment>,
}

#[uniffi::remote(Record)]
pub struct DiffSegment {
    pub text: String,
    pub emphasized: bool,
    pub kind: TokenKind,
}

#[uniffi::remote(Record)]
pub struct SideBySideRow {
    pub left: Option<DiffLine>,
    pub right: Option<DiffLine>,
}
