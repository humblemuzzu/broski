//! The rendering exports, called as the apps call them: owned values in, records out.

use std::collections::HashMap;

use broski_contract::{
    BooleanField, BooleanValue, ConditionOperator, FieldCondition, FileChange, FileChangeKind,
    FormFieldSpec, FormScalar, FormValue, GitChange, GitDiffFile, GitDiffHunk, GitDiffLine,
    GitDiffLineKind, JsonMember, JsonValue, TextValue,
};
use broski_core::{
    file_change_diff, fold_counts, form_field_default, form_field_shown, git_diff_file, highlight,
    language_for_path, normalize_language, parse_unified_diff, side_by_side, tool_look,
};
use broski_render::{DiffLineKind, FoldCount, FoldTool, FoldVerb, TokenKind, ToolFacts, ToolKind};

#[test]
fn code_comes_back_as_lines_of_spans() {
    let lines = highlight("let x = 1".to_owned(), Some("swift".to_owned()));
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

#[test]
fn a_tool_call_comes_back_as_its_row_and_the_fold_counts_what_it_did() {
    let look = tool_look(ToolFacts {
        name: "Bash".to_owned(),
        title: None,
        input: Some(JsonValue::Object(vec![JsonMember {
            key: "command".to_owned(),
            value: JsonValue::String("npm test".to_owned()),
        }])),
        has_child_session: false,
        changed_paths: Vec::new(),
    });
    assert_eq!(
        (look.kind, look.label.as_str()),
        (ToolKind::Command, "npm test")
    );
    let counts = fold_counts(vec![FoldTool {
        id: "1".to_owned(),
        kind: look.kind,
        paths: look.paths,
    }]);
    assert_eq!(
        counts,
        [FoldCount {
            verb: FoldVerb::Ran,
            count: 1,
            phrase: "Ran 1 command".to_owned()
        }]
    );
}

#[test]
fn a_form_field_is_shown_by_the_answers_and_starts_from_its_default() {
    let field = FormFieldSpec::Boolean(BooleanField {
        key: "deploy".to_owned(),
        title: None,
        description: None,
        required: false,
        hidden: false,
        when: vec![FieldCondition {
            key: "env".to_owned(),
            op: ConditionOperator::Eq,
            value: FormScalar::Text(TextValue {
                value: "prod".to_owned(),
            }),
        }],
        default_value: Some(true),
    });
    let answers = |env: &str| {
        HashMap::from([(
            "env".to_owned(),
            FormValue::Text(TextValue {
                value: env.to_owned(),
            }),
        )])
    };
    assert!(form_field_shown(field.clone(), answers("prod")));
    assert!(!form_field_shown(field.clone(), answers("dev")));
    assert_eq!(
        form_field_default(field),
        Some(FormValue::Boolean(BooleanValue { value: true }))
    );
}
