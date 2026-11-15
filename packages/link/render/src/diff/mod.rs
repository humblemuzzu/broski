//! Diffs as the chat's tool detail and the workspace's git screen draw them: files, hunks and
//! numbered lines, the changed words of a modified line marked, and rows for a side-by-side view.
//!
//! Three inputs: unified diff text (`git diff` output, `diff -u` output, or the bare hunks a tool's
//! `FileChange.diff` holds), a contract `FileChange`, and a `git.diff` answer's `GitDiffFile`.

mod contract;
mod intraline;
mod parse;
mod side;
#[cfg(test)]
mod tests;

pub use broski_contract::GitChange;

pub use self::contract::{file_change_diff, git_diff_file};
pub use self::parse::parse_unified_diff;
pub use self::side::side_by_side;

/// The diff text parsed: the contract's `MAX_TEXT_CHARS`; the rest is left out and `truncated` set.
pub const MAX_DIFF_BYTES: usize = 1_048_576;
/// Hunk lines kept, the contract's `MAX_DIFF_LINES`.
pub const MAX_DIFF_LINES: usize = 20_000;
/// A removed or added line longer than this gets no word emphasis.
pub const MAX_EMPHASIS_LINE_BYTES: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDiff {
    pub files: Vec<DiffFile>,
    /// The text went past `MAX_DIFF_BYTES` or `MAX_DIFF_LINES`, and its end is not shown.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffFile {
    /// The file's path after the change (before it, for a deleted file); empty for bare hunks
    /// that name no file.
    pub path: String,
    /// Where a renamed or copied file came from.
    pub previous_path: Option<String>,
    pub change: GitChange,
    /// Binary content: no hunks.
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_start: i64,
    pub old_lines: i64,
    pub new_start: i64,
    pub new_lines: i64,
    /// What git names after the range, such as the enclosing function.
    pub header: Option<String>,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
    /// `\ No newline at end of file`, about the line before it; it has no line numbers.
    NoNewline,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    /// The line without its `+`, `-` or space.
    pub text: String,
    /// `text` cut where a paired removed and added line differ, the changed words `emphasized`;
    /// empty when nothing in the line is emphasized.
    pub segments: Vec<DiffSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffSegment {
    pub text: String,
    pub emphasized: bool,
}

/// One row of a side-by-side view: the old line on the left, the new on the right.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SideBySideRow {
    pub left: Option<DiffLine>,
    pub right: Option<DiffLine>,
}

impl DiffFile {
    fn new(path: String, change: GitChange) -> DiffFile {
        DiffFile {
            path,
            previous_path: None,
            change,
            binary: false,
            hunks: Vec::new(),
            additions: 0,
            deletions: 0,
        }
    }

    /// Counts the lines and marks the changed words, once the hunks are complete.
    fn finish(mut self) -> DiffFile {
        let lines = self.hunks.iter().flat_map(|hunk| &hunk.lines);
        let count = |kind| lines.clone().filter(|line| line.kind == kind).count() as i64;
        self.additions = count(DiffLineKind::Added);
        self.deletions = count(DiffLineKind::Removed);
        for hunk in &mut self.hunks {
            intraline::emphasize(&mut hunk.lines);
        }
        self
    }
}

impl DiffLine {
    fn new(
        kind: DiffLineKind,
        old_line: Option<i64>,
        new_line: Option<i64>,
        text: &str,
    ) -> DiffLine {
        DiffLine {
            kind,
            old_line,
            new_line,
            text: text.to_owned(),
            segments: Vec::new(),
        }
    }
}
