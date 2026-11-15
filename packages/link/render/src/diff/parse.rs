//! Unified diff text, line by line: `git diff`'s extended headers, `diff -u`'s `---`/`+++` pair,
//! or bare hunks. A hunk's line counts say where its body ends, so a body line that looks like a
//! header (`--- x` removed) is read as the line it is.

use super::{DiffFile, DiffHunk, DiffLine, DiffLineKind, GitChange, ParsedDiff};
use super::{MAX_DIFF_BYTES, MAX_DIFF_LINES};
use crate::prefix;

/// Every file of `text`; bare hunks are one file with an empty path.
pub fn parse_unified_diff(text: &str) -> ParsedDiff {
    let bounded = prefix(text, MAX_DIFF_BYTES);
    let mut parser = Parser::default();
    for line in bounded.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if !parser.line(line) {
            break;
        }
    }
    parser.finish(bounded.len() < text.len())
}

/// A file being read: what its headers said so far.
struct File {
    diff: DiffFile,
    old: Option<String>,
    new: Option<String>,
}

struct Hunk {
    hunk: DiffHunk,
    old: i64,
    new: i64,
    old_left: i64,
    new_left: i64,
}

#[derive(Default)]
struct Parser {
    files: Vec<DiffFile>,
    file: Option<File>,
    hunk: Option<Hunk>,
    /// Inside a `GIT binary patch`, whose lines are data.
    binary_patch: bool,
    lines: usize,
    truncated: bool,
}

impl Parser {
    /// False once the line bound is reached.
    fn line(&mut self, line: &str) -> bool {
        if line.starts_with('\\') && self.hunk.is_some() {
            return self.push(DiffLine::new(
                DiffLineKind::NoNewline,
                None,
                None,
                line.trim_start_matches(['\\', ' ']),
            ));
        }
        if self.in_body(line) {
            return self.body_line(line);
        }
        if let Some(paths) = line.strip_prefix("diff --git ") {
            self.start_file(git_path(paths));
            return true;
        }
        if self.binary_patch {
            return true;
        }
        if let Some(hunk) = hunk_header(line) {
            self.open_hunk(hunk);
            return true;
        }
        self.header(line);
        true
    }

    fn in_body(&self, line: &str) -> bool {
        let open = self
            .hunk
            .as_ref()
            .is_some_and(|hunk| hunk.old_left > 0 || hunk.new_left > 0);
        open && (line.is_empty() || line.starts_with([' ', '+', '-']))
    }

    fn body_line(&mut self, line: &str) -> bool {
        let Some(hunk) = &mut self.hunk else {
            return true;
        };
        let (marker, text) = line.split_at(line.len().min(1));
        let diff_line = match marker {
            "+" => {
                hunk.new_left -= 1;
                hunk.new += 1;
                DiffLine::new(DiffLineKind::Added, None, Some(hunk.new - 1), text)
            }
            "-" => {
                hunk.old_left -= 1;
                hunk.old += 1;
                DiffLine::new(DiffLineKind::Removed, Some(hunk.old - 1), None, text)
            }
            _ => {
                hunk.old_left -= 1;
                hunk.new_left -= 1;
                hunk.old += 1;
                hunk.new += 1;
                let (old, new) = (Some(hunk.old - 1), Some(hunk.new - 1));
                DiffLine::new(DiffLineKind::Context, old, new, text)
            }
        };
        self.push(diff_line)
    }

    fn push(&mut self, line: DiffLine) -> bool {
        self.lines += 1;
        if self.lines > MAX_DIFF_LINES {
            self.truncated = true;
            return false;
        }
        if let Some(hunk) = &mut self.hunk {
            hunk.hunk.lines.push(line);
        }
        true
    }

    fn header(&mut self, line: &str) {
        if let Some(path) = line.strip_prefix("--- ") {
            let has_hunks = self
                .file
                .as_ref()
                .is_some_and(|file| !file.diff.hunks.is_empty() || self.hunk.is_some());
            if self.file.is_none() || has_hunks {
                self.start_file(String::new());
            }
            self.with_file(|file| file.old = Some(file_path(path, "a/")));
            return;
        }
        if let Some(path) = line.strip_prefix("+++ ") {
            self.with_file(|file| file.new = Some(file_path(path, "b/")));
            return;
        }
        let Some(file) = self.file.as_mut() else {
            return;
        };
        let diff = &mut file.diff;
        if line.starts_with("new file mode ") {
            diff.change = GitChange::Added;
        } else if line.starts_with("deleted file mode ") {
            diff.change = GitChange::Deleted;
        } else if let Some(from) = line
            .strip_prefix("rename from ")
            .or(line.strip_prefix("copy from "))
        {
            diff.change = if line.starts_with("copy") {
                GitChange::Copied
            } else {
                GitChange::Renamed
            };
            diff.previous_path = Some(from.to_owned());
        } else if let Some(to) = line
            .strip_prefix("rename to ")
            .or(line.strip_prefix("copy to "))
        {
            diff.path = to.to_owned();
        } else if line.starts_with("Binary files ") && line.ends_with(" differ") {
            diff.binary = true;
        } else if line == "GIT binary patch" {
            diff.binary = true;
            self.binary_patch = true;
        }
    }

    fn with_file(&mut self, act: impl FnOnce(&mut File)) {
        if let Some(file) = &mut self.file {
            act(file);
        }
    }

    fn start_file(&mut self, path: String) {
        self.close_file();
        self.binary_patch = false;
        self.file = Some(File {
            diff: DiffFile::new(path, GitChange::Modified),
            old: None,
            new: None,
        });
    }

    fn open_hunk(&mut self, hunk: DiffHunk) {
        self.close_hunk();
        if self.file.is_none() {
            self.start_file(String::new());
        }
        self.hunk = Some(Hunk {
            old: hunk.old_start,
            new: hunk.new_start,
            old_left: hunk.old_lines,
            new_left: hunk.new_lines,
            hunk,
        });
    }

    fn close_hunk(&mut self) {
        if let (Some(hunk), Some(file)) = (self.hunk.take(), self.file.as_mut()) {
            file.diff.hunks.push(hunk.hunk);
        }
    }

    fn close_file(&mut self) {
        self.close_hunk();
        if let Some(file) = self.file.take() {
            self.files.push(settle_paths(file).finish());
        }
    }

    fn finish(mut self, cut: bool) -> ParsedDiff {
        self.close_file();
        ParsedDiff {
            files: self.files,
            truncated: self.truncated || cut,
        }
    }
}

/// The path and change the `---`/`+++` pair implies, unless a rename or copy header said them.
fn settle_paths(file: File) -> DiffFile {
    let File { mut diff, old, new } = file;
    if matches!(diff.change, GitChange::Renamed | GitChange::Copied) {
        return diff;
    }
    const NULL: &str = "/dev/null";
    match (old, new) {
        (Some(old), Some(new)) if new == NULL => {
            diff.change = GitChange::Deleted;
            diff.path = old;
        }
        (Some(old), Some(new)) if old == NULL => {
            diff.change = GitChange::Added;
            diff.path = new;
        }
        (_, Some(new)) => diff.path = new,
        _ => {}
    }
    diff
}

/// `-a,b +c,d @@ header`; a missing count is 1.
fn hunk_header(line: &str) -> Option<DiffHunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (ranges, header) = rest.split_once(" @@")?;
    let (old, new) = ranges.split_once(" +")?;
    let range = |text: &str| -> Option<(i64, i64)> {
        match text.split_once(',') {
            Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
            None => Some((text.parse().ok()?, 1)),
        }
    };
    let ((old_start, old_lines), (new_start, new_lines)) = (range(old)?, range(new)?);
    let header = header.trim();
    Some(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        header: (!header.is_empty()).then(|| header.to_owned()),
        lines: Vec::new(),
    })
}

/// The new path of `a/<old> b/<new>`: the split where both sides name the same file when there is
/// one (a path may hold ` b/`), else the last.
fn git_path(paths: &str) -> String {
    let paths = paths.strip_prefix("a/").unwrap_or(paths);
    let splits: Vec<usize> = paths.match_indices(" b/").map(|(at, _)| at).collect();
    let same = splits.iter().find(|&&at| paths[..at] == paths[at + 3..]);
    match same.or(splits.last()) {
        Some(&at) => paths[at + 3..].to_owned(),
        None => paths.to_owned(),
    }
}

/// A `---`/`+++` path without git's `a/` or `b/` and without `diff -u`'s tab and timestamp.
fn file_path(path: &str, side: &str) -> String {
    let path = path.split('\t').next().unwrap_or(path);
    path.strip_prefix(side).unwrap_or(path).to_owned()
}
