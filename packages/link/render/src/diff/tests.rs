use broski_contract::{
    FileChange, FileChangeKind, GitDiffFile, GitDiffHunk, GitDiffLine, GitDiffLineKind,
};

use super::*;

const GIT_DIFF: &str = include_str!("../../tests/fixtures/git-diff.diff");
const BINARY_PATCH: &str = include_str!("../../tests/fixtures/git-binary-patch.diff");
const DIFF_U: &str = include_str!("../../tests/fixtures/diff-u.diff");
/// The fake backend's `EDIT` (packages/bridge/scripts/dev-fake-bridge/scenarios.ts).
const FAKE_EDIT: &str = "@@ -1 +1 @@\n-one\n+two\n";

fn file<'a>(parsed: &'a ParsedDiff, path: &str) -> &'a DiffFile {
    parsed
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| {
            panic!(
                "no {path} in {:?}",
                parsed.files.iter().map(|f| &f.path).collect::<Vec<_>>()
            )
        })
}

/// Each line as git prints it, with its numbers: `+ ·3 text`.
fn printed(hunk: &DiffHunk) -> Vec<String> {
    let number = |n: Option<i64>| n.map_or("·".to_owned(), |n| n.to_string());
    hunk.lines
        .iter()
        .map(|line| {
            let mark = match line.kind {
                DiffLineKind::Context => ' ',
                DiffLineKind::Added => '+',
                DiffLineKind::Removed => '-',
                DiffLineKind::NoNewline => '\\',
            };
            format!(
                "{mark}{}{} {}",
                number(line.old_line),
                number(line.new_line),
                line.text
            )
        })
        .collect()
}

fn emphasized(line: &DiffLine) -> Vec<&str> {
    line.segments
        .iter()
        .filter(|segment| segment.emphasized)
        .map(|segment| segment.text.as_str())
        .collect()
}

#[test]
fn a_real_git_diff_reads_as_its_files() {
    let parsed = parse_unified_diff(GIT_DIFF);
    assert!(!parsed.truncated);
    let summary: Vec<_> = parsed
        .files
        .iter()
        .map(|file| {
            (
                file.path.as_str(),
                file.change,
                file.binary,
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("eof.txt", GitChange::Modified, false, 1, 1),
            ("logo.png", GitChange::Modified, true, 0, 0),
            ("main.rs", GitChange::Modified, false, 3, 2),
            ("new.txt", GitChange::Added, false, 1, 0),
            ("notes.md", GitChange::Modified, false, 1, 1),
            ("old.txt", GitChange::Deleted, false, 0, 1),
            ("renamed.txt", GitChange::Renamed, false, 1, 1),
        ]
    );
    assert!(file(&parsed, "logo.png").hunks.is_empty());
    let renamed = file(&parsed, "renamed.txt");
    assert_eq!(renamed.previous_path.as_deref(), Some("moved.txt"));
    let hunk = &renamed.hunks[0];
    assert_eq!(
        (
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines
        ),
        (7, 4, 7, 4)
    );
    assert_eq!(hunk.header.as_deref(), Some("line f"));
    assert_eq!(
        printed(hunk),
        [
            " 77 line g",
            " 88 line h",
            " 99 line i",
            "-10· line j",
            "+·10 line J"
        ]
    );
    assert_eq!(
        printed(&file(&parsed, "new.txt").hunks[0]),
        ["+·1 brand new"]
    );
    assert_eq!(printed(&file(&parsed, "old.txt").hunks[0]), ["-1· gone"]);
}

#[test]
fn no_newline_at_the_end_is_a_line_of_its_own_about_the_one_before() {
    let parsed = parse_unified_diff(GIT_DIFF);
    let hunk = &file(&parsed, "eof.txt").hunks[0];
    assert_eq!(
        printed(hunk),
        [
            "-1· last line",
            "\\·· No newline at end of file",
            "+·1 last line changed",
            "\\·· No newline at end of file"
        ]
    );
    assert_eq!(
        emphasized(&hunk.lines[2]),
        [" changed"],
        "paired across the marker"
    );
    let rows = side_by_side(hunk);
    let sides: Vec<_> = rows
        .iter()
        .map(|row| {
            (
                row.left.as_ref().map(|l| l.kind),
                row.right.as_ref().map(|r| r.kind),
            )
        })
        .collect();
    assert_eq!(
        sides,
        [
            (Some(DiffLineKind::Removed), Some(DiffLineKind::Added)),
            (Some(DiffLineKind::NoNewline), Some(DiffLineKind::NoNewline)),
        ]
    );
}

#[test]
fn a_binary_patch_is_binary_and_its_data_is_not_read() {
    let parsed = parse_unified_diff(BINARY_PATCH);
    assert_eq!(parsed.files.len(), 1);
    let logo = &parsed.files[0];
    assert!(logo.binary);
    assert!(logo.hunks.is_empty());
    assert_eq!(
        (logo.path.as_str(), logo.change),
        ("logo.png", GitChange::Modified)
    );
}

#[test]
fn a_changed_line_marks_only_the_words_it_changed() {
    let parsed = parse_unified_diff(GIT_DIFF);
    let lines = &file(&parsed, "main.rs").hunks[0].lines;
    assert_eq!(
        emphasized(&lines[1]),
        [] as [&str; 0],
        "nothing removed from the first line"
    );
    assert_eq!(emphasized(&lines[3]), ["there "]);
    assert_eq!(emphasized(&lines[2]), ["1"]);
    assert_eq!(emphasized(&lines[4]), ["2"]);
    assert!(
        emphasized(&lines[5]).is_empty(),
        "an added line with no partner"
    );
    let joined: String = lines[3]
        .segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect();
    assert_eq!(joined, lines[3].text, "segments cover the line");
}

#[test]
fn a_rewritten_line_or_a_long_one_gets_no_emphasis() {
    let rewritten =
        parse_unified_diff("@@ -1 +1 @@\n-the quick brown fox\n+entirely different words here\n");
    assert!(rewritten.files[0].hunks[0]
        .lines
        .iter()
        .all(|line| line.segments.is_empty()));
    let long = "x ".repeat(MAX_EMPHASIS_LINE_BYTES);
    let text = format!("@@ -1 +1 @@\n-{long}a\n+{long}b\n");
    let parsed = parse_unified_diff(&text);
    assert!(parsed.files[0].hunks[0]
        .lines
        .iter()
        .all(|line| line.segments.is_empty()));
}

#[test]
fn whitespace_between_changed_words_joins_their_emphasis() {
    let parsed = parse_unified_diff("@@ -1 +1 @@\n-let a b = 1;\n+let x y = 1;\n");
    let lines = &parsed.files[0].hunks[0].lines;
    assert_eq!(emphasized(&lines[0]), ["a b"]);
    assert_eq!(emphasized(&lines[1]), ["x y"]);
}

#[test]
fn diff_u_output_and_the_fake_backends_bare_hunks() {
    let parsed = parse_unified_diff(DIFF_U);
    assert_eq!(parsed.files.len(), 1);
    assert_eq!(
        parsed.files[0].path, "config.new",
        "the timestamp is not part of the path"
    );
    assert_eq!(
        printed(&parsed.files[0].hunks[0])[1..3],
        ["-2· beta", "+·2 BETA"]
    );
    assert!(
        parsed.files[0].hunks[0]
            .lines
            .iter()
            .all(|line| line.segments.is_empty()),
        "a line changed whole marks nothing within it"
    );

    let parsed = parse_unified_diff(FAKE_EDIT);
    assert_eq!(parsed.files.len(), 1);
    assert_eq!(parsed.files[0].path, "");
    assert_eq!(printed(&parsed.files[0].hunks[0]), ["-1· one", "+·1 two"]);
}

#[test]
fn a_hunk_body_line_that_looks_like_a_header_is_a_line() {
    let text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- a/old\n+++ b/new\n diff --git a/y b/y\n";
    let parsed = parse_unified_diff(text);
    assert_eq!(parsed.files.len(), 1);
    assert_eq!(
        printed(&parsed.files[0].hunks[0]),
        ["-1· -- a/old", "+·1 ++ b/new", " 22 diff --git a/y b/y"]
    );
}

#[test]
fn a_tools_file_change_takes_its_path_and_kind_from_the_contract() {
    let change = FileChange {
        path: "notes.md".to_owned(),
        change: FileChangeKind::Modified,
        previous_path: None,
        diff: Some(FAKE_EDIT.to_owned()),
        additions: Some(1),
        deletions: Some(1),
    };
    let diff = file_change_diff(&change);
    assert_eq!(
        (
            diff.path.as_str(),
            diff.change,
            diff.additions,
            diff.deletions
        ),
        ("notes.md", GitChange::Modified, 1, 1)
    );
    assert_eq!(printed(&diff.hunks[0]), ["-1· one", "+·1 two"]);

    let renamed = FileChange {
        path: "b.rs".to_owned(),
        change: FileChangeKind::Renamed,
        previous_path: Some("a.rs".to_owned()),
        diff: None,
        additions: Some(4),
        deletions: None,
    };
    let diff = file_change_diff(&renamed);
    assert_eq!(diff.previous_path.as_deref(), Some("a.rs"));
    assert_eq!(
        (diff.change, diff.additions, diff.deletions),
        (GitChange::Renamed, 4, 0)
    );
    assert!(diff.hunks.is_empty());
}

#[test]
fn a_git_diff_answer_gains_emphasis_and_its_no_newline_marker() {
    let line = |kind, text: &str, old_line, new_line, no_newline| GitDiffLine {
        kind,
        text: text.to_owned(),
        old_line,
        new_line,
        no_newline,
    };
    let answer = GitDiffFile {
        path: "eof.txt".to_owned(),
        previous_path: None,
        change: GitChange::Modified,
        binary: false,
        hunks: vec![GitDiffHunk {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            header: None,
            lines: vec![
                line(
                    GitDiffLineKind::Removed,
                    "last line",
                    Some(1),
                    None,
                    Some(true),
                ),
                line(
                    GitDiffLineKind::Added,
                    "last line changed",
                    None,
                    Some(1),
                    Some(true),
                ),
            ],
        }],
    };
    let diff = git_diff_file(&answer);
    assert_eq!(
        diff,
        parse_unified_diff(GIT_DIFF).files[0],
        "the same file as git's own text"
    );
}

#[test]
fn side_by_side_pairs_a_modification_and_leaves_extra_lines_one_sided() {
    let parsed = parse_unified_diff(GIT_DIFF);
    let rows = side_by_side(&file(&parsed, "main.rs").hunks[0]);
    let texts: Vec<_> = rows
        .iter()
        .map(|row| {
            let side =
                |line: &Option<DiffLine>| line.as_ref().map(|line| line.text.trim().to_owned());
            (side(&row.left), side(&row.right))
        })
        .collect();
    let some = |text: &str| Some(text.to_owned());
    assert_eq!(
        texts,
        [
            (some("fn main() {"), some("fn main() {")),
            (
                some("println!(\"hello world\");"),
                some("println!(\"hello there world\");")
            ),
            (some("let count = 1;"), some("let count = 2;")),
            (None, some("let extra = true;")),
            (some("}"), some("}")),
        ]
    );
}

#[test]
fn a_diff_past_the_line_bound_is_cut_and_says_so() {
    let mut text = format!("@@ -1,{0} +1,{0} @@\n", MAX_DIFF_LINES + 5);
    text.push_str(&" same\n".repeat(MAX_DIFF_LINES + 5));
    let parsed = parse_unified_diff(&text);
    assert!(parsed.truncated);
    assert_eq!(parsed.files[0].hunks[0].lines.len(), MAX_DIFF_LINES);
}

#[test]
fn code_diffs_carry_both_syntax_tokens_and_word_emphasis() {
    use crate::highlight::TokenKind;

    let parsed = parse_unified_diff(GIT_DIFF);
    let main_rs = file(&parsed, "main.rs");
    let hunk = &main_rs.hunks[0];
    // Context line `fn main() {` has syntax tokens without emphasis.
    let fn_line = &hunk.lines[0];
    assert!(
        fn_line.segments.iter().any(|seg| seg.text.trim() == "fn"
            && seg.kind == TokenKind::Keyword
            && !seg.emphasized),
        "context line should carry Rust keyword colouring: {:?}",
        fn_line.segments
    );
    // Added modified line `    let count = 2;` has both Keyword (`let`) and emphasized Number (`2`).
    let added = hunk
        .lines
        .iter()
        .find(|line| line.kind == DiffLineKind::Added && line.text.contains("let count = 2;"))
        .expect("added let count = 2 line");
    let joined: String = added.segments.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(joined, added.text, "segments join back to exact line text");
    assert!(
        added.segments.iter().any(|seg| seg.text.trim() == "let"
            && seg.kind == TokenKind::Keyword
            && !seg.emphasized),
        "unchanged keyword keeps syntax kind without emphasis: {:?}",
        added.segments
    );
    assert!(
        added
            .segments
            .iter()
            .any(|seg| seg.text == "2" && seg.kind == TokenKind::Number && seg.emphasized),
        "changed literal keeps both syntax kind and word emphasis: {:?}",
        added.segments
    );
}
