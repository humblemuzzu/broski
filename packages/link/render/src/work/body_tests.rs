//! Results and arguments as the agents really write them (Claude Code 2.1.325's recorded frames,
//! Pi 1.5.2's `read`), read for the work fold.

use broski_contract::{JsonMember, JsonValue};

use super::*;
use crate::format::LinkKind;
use crate::highlight::TokenKind;
use crate::ClipEnd;

fn object(members: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        members
            .into_iter()
            .map(|(key, value)| JsonMember {
                key: key.to_owned(),
                value,
            })
            .collect(),
    )
}

fn text(value: &str) -> JsonValue {
    JsonValue::String(value.to_owned())
}

fn facts(name: &str, input: JsonValue) -> ToolFacts {
    ToolFacts {
        name: name.to_owned(),
        title: None,
        input: Some(input),
        has_child_session: false,
        changed_paths: Vec::new(),
    }
}

#[test]
fn a_read_without_a_display_is_its_file_numbered_from_the_line_the_tool_numbered_first() {
    let recorded = "1\t# Scripted project\n2\t\n3\tThe magic word is PLUMBUS.\n4\t";
    let read = facts("Read", object(vec![("file_path", text("README.md"))]));
    assert_eq!(
        tool_body(&read, recorded),
        ToolBody::FileText {
            path: "README.md".to_owned(),
            language: Some("Markdown".to_owned()),
            first_line: 1,
            text: "# Scripted project\n\nThe magic word is PLUMBUS.\n".to_owned(),
        }
    );
    let arrows = "    40→fn main() {\n    41→}";
    let rust = facts("Read", object(vec![("file_path", text("src/main.rs"))]));
    assert!(matches!(
        tool_body(&rust, arrows),
        ToolBody::FileText { first_line: 40, ref text, .. } if text == "fn main() {\n}"
    ));
    let pi = facts(
        "read",
        object(vec![
            ("path", text("long.txt")),
            ("offset", JsonValue::Number(3.0)),
        ]),
    );
    assert!(matches!(
        tool_body(&pi, "line 3\nline 4"),
        ToolBody::FileText { first_line: 3, .. }
    ));
}

#[test]
fn a_search_is_rows_that_open_their_files_with_the_match_marked() {
    let grep = facts(
        "Grep",
        object(vec![
            ("pattern", text("TODO")),
            ("output_mode", text("content")),
        ]),
    );
    let ToolBody::Matches { rows, hidden_rows } =
        tool_body(&grep, "a.ts:1:// TODO split\nsrc/b.rs:12:  TODO")
    else {
        panic!("rows");
    };
    assert_eq!(hidden_rows, 0);
    assert_eq!((rows[0].path.as_str(), rows[0].line), ("a.ts", Some(1)));
    let marked: Vec<(&str, bool)> = rows[0]
        .segments
        .iter()
        .map(|s| (s.text.as_str(), s.matched))
        .collect();
    assert_eq!(marked, [("// ", false), ("TODO", true), (" split", false)]);
    let regex = facts("Grep", object(vec![("pattern", text("fn \\w+"))]));
    let ToolBody::Matches { rows, .. } = tool_body(&regex, "a.rs:3:fn main") else {
        panic!("rows");
    };
    assert!(
        rows[0].segments.iter().all(|segment| !segment.matched),
        "a regex is not guessed at"
    );
    let find = facts("find", object(vec![("pattern", text("*.md"))]));
    let ToolBody::Matches { rows, .. } = tool_body(&find, "README.md\ndocs/a.md\n") else {
        panic!("rows");
    };
    assert_eq!(
        rows.iter()
            .map(|row| (row.path.as_str(), row.line))
            .collect::<Vec<_>>(),
        [("README.md", None), ("docs/a.md", None)]
    );
    let prose = facts("Grep", object(vec![("pattern", text("x"))]));
    assert!(matches!(
        tool_body(&prose, "No matches found"),
        ToolBody::Log { .. }
    ));
}

#[test]
fn a_command_is_a_log_of_its_last_lines_with_its_links_found() {
    let bash = facts("Bash", object(vec![("command", text("bun dev"))]));
    let output = format!(
        "{}\n  ➜  Local:   http://localhost:5173/\nerror in src/app.ts:12:4",
        "build\n".repeat(300)
    );
    let ToolBody::Log {
        lines,
        hidden_lines,
    } = tool_body(&bash, &output)
    else {
        panic!("a log");
    };
    assert_eq!(lines.len(), TOOL_LOG_LINES as usize);
    assert_eq!(
        hidden_lines as usize,
        output.lines().count() - TOOL_LOG_LINES as usize
    );
    let linked: Vec<(&str, &LinkKind)> = lines
        .iter()
        .flat_map(|line| &line.spans)
        .filter_map(|span| {
            span.link
                .as_ref()
                .map(|link| (span.text.as_str(), &link.kind))
        })
        .collect();
    assert_eq!(
        linked,
        [
            ("http://localhost:5173/", &LinkKind::Web),
            (
                "src/app.ts:12:4",
                &LinkKind::File {
                    line: Some(12),
                    column: Some(4)
                }
            ),
        ]
    );
    assert_eq!(tool_body(&bash, " \n"), ToolBody::Empty);
}

#[test]
fn an_error_keeps_its_first_lines_and_says_how_many_it_left_out() {
    let error = format!("failed at src/lib.rs:7\n{}", "  at frame\n".repeat(50));
    let log = format_log(&error, 3, ClipEnd::Head);
    let shown: Vec<String> = log
        .lines
        .iter()
        .map(|line| line.spans.iter().map(|span| span.text.as_str()).collect())
        .collect();
    assert_eq!(
        shown,
        ["failed at src/lib.rs:7", "  at frame", "  at frame"]
    );
    assert_eq!(log.hidden_lines, 48);
    assert!(log.lines[0]
        .spans
        .iter()
        .any(|span| span.text == "src/lib.rs:7"
            && matches!(
                span.link.as_ref().map(|link| &link.kind),
                Some(LinkKind::File { line: Some(7), .. })
            )));
}

#[test]
fn reports_are_markdown_and_unknown_tools_show_json_markdown_or_a_log() {
    let agent = facts("Agent", object(vec![("prompt", text("Read README.md"))]));
    assert_eq!(
        tool_body(&agent, "\nSubagent: PLUMBUS."),
        ToolBody::Markdown {
            text: "Subagent: PLUMBUS.".to_owned()
        }
    );
    let mcp = facts("mcp__github__get_issue", object(vec![]));
    let ToolBody::Json { lines } = tool_body(&mcp, r#"{"number":42,"labels":["bug"],"open":true}"#)
    else {
        panic!("json");
    };
    let first_member: Vec<TokenKind> = lines[1].spans.iter().map(|span| span.kind).collect();
    assert_eq!(
        first_member,
        [
            TokenKind::Plain,
            TokenKind::Property,
            TokenKind::Punctuation,
            TokenKind::Number,
            TokenKind::Punctuation
        ]
    );
    assert_eq!(
        lines.len(),
        7,
        "members in the order written, each on its line"
    );
    assert!(matches!(
        tool_body(&mcp, "## Issue 42\n\n- **open**"),
        ToolBody::Markdown { .. }
    ));
    assert!(matches!(tool_body(&mcp, "done"), ToolBody::Log { .. }));
}

#[test]
fn arguments_are_a_property_list_with_code_in_its_files_language_and_prose_formatted() {
    let edit = facts(
        "Edit",
        object(vec![
            ("file_path", text("src/a.ts")),
            ("old_string", text("a\nb")),
            ("new_string", text("c")),
        ]),
    );
    let rows = tool_arguments(&edit);
    assert_eq!(
        rows[0].value,
        ArgumentValue::Inline {
            text: "src/a.ts".to_owned(),
            kind: TokenKind::String
        }
    );
    assert!(
        matches!(&rows[1].value, ArgumentValue::Code { language: Some(language), .. } if language == "TypeScript")
    );
    let task = facts(
        "Task",
        object(vec![
            ("description", text("Audit")),
            ("prompt", text("## Goal\n\n- **find** the leak\n- fix it")),
        ]),
    );
    let rows = tool_arguments(&task);
    assert!(
        matches!(&rows[1].value, ArgumentValue::Markdown { text } if text.starts_with("## Goal"))
    );
    let bash = facts(
        "Bash",
        object(vec![
            ("command", text("bun test")),
            ("description", text("Run the tests")),
            ("timeout", JsonValue::Number(120000.0)),
        ]),
    );
    let keys: Vec<String> = tool_arguments(&bash)
        .into_iter()
        .map(|row| row.key)
        .collect();
    assert_eq!(
        keys,
        ["description", "timeout"],
        "the command shows on the call's row"
    );
}

#[test]
fn nested_arguments_open_one_level_further_in_and_short_lists_stay_on_one_line() {
    let option = |label: &str| object(vec![("label", text(label)), ("description", text("cool"))]);
    let question = object(vec![
        ("question", text("Which color?")),
        (
            "options",
            JsonValue::Array(vec![option("Red"), option("Blue")]),
        ),
        ("multiSelect", JsonValue::Bool(false)),
    ]);
    let ask = facts(
        "AskUserQuestion",
        object(vec![("questions", JsonValue::Array(vec![question]))]),
    );
    let rows: Vec<(String, u32)> = tool_arguments(&ask)
        .into_iter()
        .map(|row| (row.key, row.depth))
        .collect();
    let expected: Vec<(String, u32)> = [
        ("questions", 0),
        ("1", 1),
        ("question", 2),
        ("options", 2),
        ("1", 3),
        ("label", 4),
        ("description", 4),
        ("2", 3),
        ("label", 4),
        ("description", 4),
        ("multiSelect", 2),
    ]
    .into_iter()
    .map(|(key, depth)| (key.to_owned(), depth))
    .collect();
    assert_eq!(rows, expected);
    let glob = facts(
        "Glob",
        object(vec![(
            "paths",
            JsonValue::Array(vec![text("a.ts"), text("b.ts")]),
        )]),
    );
    assert_eq!(
        tool_arguments(&glob)[0].value,
        ArgumentValue::Inline {
            text: "a.ts, b.ts".to_owned(),
            kind: TokenKind::String
        }
    );
}
