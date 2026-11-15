//! The rendering exports, called as the apps call them: owned values in, records out.

use broski_contract::{
    FileChange, FileChangeKind, GitChange, GitDiffFile, GitDiffHunk, GitDiffLine, GitDiffLineKind,
};
use broski_core::{
    file_change_diff, git_diff_file, highlight, language_for_path, markdown_blocks,
    normalize_language, parse_unified_diff, side_by_side,
};
use broski_render::{BlockContent, DiffLineKind, TokenKind};

#[test]
fn markdown_and_code_come_back_as_blocks_and_spans() {
    let blocks = markdown_blocks("# Done\n\n```swift\nlet x = 1\n```".to_owned());
    assert_eq!(blocks.len(), 2);
    let BlockContent::Code { language, text } = &blocks[1].content else {
        panic!("a code block: {:?}", blocks[1]);
    };
    assert_eq!(language.as_deref(), Some("swift"));
    let lines = highlight(text.clone(), language.clone());
    assert_eq!(lines[0].spans[0].kind, TokenKind::Keyword);
    assert_eq!(
        normalize_language("kt".to_owned()).as_deref(),
        Some("Kotlin")
    );
    assert_eq!(
        language_for_path("a/b.rs".to_owned()).as_deref(),
        Some("Rust")
    );
}

#[test]
fn both_kinds_of_diff_come_back_as_files_and_rows() {
    let parsed = parse_unified_diff("@@ -1 +1 @@\n-let a = 1;\n+let a = 2;\n".to_owned());
    let hunk = parsed.files[0].hunks[0].clone();
    assert!(hunk.lines[1]
        .segments
        .iter()
        .any(|segment| segment.emphasized));
    assert_eq!(side_by_side(hunk).len(), 1, "one modified line, one row");

    let change = file_change_diff(FileChange {
        path: "notes.md".to_owned(),
        change: FileChangeKind::Modified,
        previous_path: None,
        diff: Some("@@ -1 +1 @@\n-one\n+two\n".to_owned()),
        additions: Some(1),
        deletions: Some(1),
    });
    assert_eq!((change.path.as_str(), change.additions), ("notes.md", 1));

    let git = git_diff_file(GitDiffFile {
        path: "a.txt".to_owned(),
        previous_path: None,
        change: GitChange::Added,
        binary: false,
        hunks: vec![GitDiffHunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: 1,
            header: None,
            lines: vec![GitDiffLine {
                kind: GitDiffLineKind::Added,
                text: "hi".to_owned(),
                old_line: None,
                new_line: Some(1),
                no_newline: Some(true),
            }],
        }],
    });
    let kinds: Vec<_> = git.hunks[0].lines.iter().map(|line| line.kind).collect();
    assert_eq!(kinds, [DiffLineKind::Added, DiffLineKind::NoNewline]);
}
