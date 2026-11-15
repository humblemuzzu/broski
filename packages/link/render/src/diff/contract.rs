//! The contract's two shapes of a diff, as `DiffFile`s.

use broski_contract::{FileChange, FileChangeKind, GitDiffFile, GitDiffHunk, GitDiffLineKind};

use super::{parse_unified_diff, DiffFile, DiffHunk, DiffLine, DiffLineKind, GitChange};

/// What git prints for a line `noNewline` marks.
const NO_NEWLINE: &str = "No newline at end of file";

/// A tool's file change: the path and kind it names, the hunks of its unified `diff` (bare hunks
/// or with file headers). Without a `diff` there are no hunks, and the counts are the change's own.
pub fn file_change_diff(change: &FileChange) -> DiffFile {
    let kind = match change.change {
        FileChangeKind::Added => GitChange::Added,
        FileChangeKind::Deleted => GitChange::Deleted,
        FileChangeKind::Modified => GitChange::Modified,
        FileChangeKind::Renamed => GitChange::Renamed,
    };
    let mut file = DiffFile::new(change.path.clone(), kind);
    file.previous_path = change.previous_path.clone();
    let Some(diff) = &change.diff else {
        file.additions = change.additions.unwrap_or(0);
        file.deletions = change.deletions.unwrap_or(0);
        return file;
    };
    for parsed in parse_unified_diff(diff).files {
        file.binary |= parsed.binary;
        file.additions += parsed.additions;
        file.deletions += parsed.deletions;
        file.hunks.extend(parsed.hunks);
    }
    file
}

/// One file of a `git.diff` answer, with the changed words of its modified lines marked.
pub fn git_diff_file(file: &GitDiffFile) -> DiffFile {
    let mut diff = DiffFile::new(file.path.clone(), file.change);
    diff.previous_path = file.previous_path.clone();
    diff.binary = file.binary;
    diff.hunks = file.hunks.iter().map(hunk).collect();
    diff.finish()
}

fn hunk(hunk: &GitDiffHunk) -> DiffHunk {
    let mut lines = Vec::with_capacity(hunk.lines.len());
    for line in &hunk.lines {
        let kind = match line.kind {
            GitDiffLineKind::Context => DiffLineKind::Context,
            GitDiffLineKind::Added => DiffLineKind::Added,
            GitDiffLineKind::Removed => DiffLineKind::Removed,
        };
        lines.push(DiffLine::new(
            kind,
            line.old_line,
            line.new_line,
            &line.text,
        ));
        if line.no_newline == Some(true) {
            lines.push(DiffLine::new(
                DiffLineKind::NoNewline,
                None,
                None,
                NO_NEWLINE,
            ));
        }
    }
    DiffHunk {
        old_start: hunk.old_start,
        old_lines: hunk.old_lines,
        new_start: hunk.new_start,
        new_lines: hunk.new_lines,
        header: hunk.header.clone(),
        lines,
    }
}
