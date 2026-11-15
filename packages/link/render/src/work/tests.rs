use broski_contract::JsonMember;

use super::*;

fn input(members: &[(&str, &str)]) -> Option<JsonValue> {
    Some(JsonValue::Object(
        members
            .iter()
            .map(|(key, value)| JsonMember {
                key: (*key).to_owned(),
                value: JsonValue::String((*value).to_owned()),
            })
            .collect(),
    ))
}

fn call(name: &str, input: Option<JsonValue>) -> ToolFacts {
    ToolFacts {
        name: name.to_owned(),
        title: None,
        input,
        has_child_session: false,
        changed_paths: Vec::new(),
    }
}

fn look(name: &str, members: &[(&str, &str)]) -> ToolLook {
    tool_look(&call(name, input(members)))
}

#[test]
fn every_tool_name_either_app_knew_has_one_kind_in_any_case() {
    let named = [
        (
            ToolKind::Read,
            &["read", "view", "cat", "notebookread", "read_file"][..],
        ),
        (
            ToolKind::Edit,
            &[
                "edit",
                "write",
                "multiedit",
                "notebookedit",
                "patch",
                "apply_patch",
                "str_replace",
                "create",
                "write_file",
            ],
        ),
        (
            ToolKind::Command,
            &[
                "bash",
                "shell",
                "exec",
                "command",
                "run",
                "terminal",
                "bashoutput",
                "killshell",
            ],
        ),
        (
            ToolKind::Search,
            &["grep", "glob", "find", "ls", "search", "list", "toolsearch"],
        ),
        (
            ToolKind::Web,
            &[
                "webfetch",
                "websearch",
                "fetch",
                "web_fetch",
                "web_search",
                "browse",
            ],
        ),
        (ToolKind::Agent, &["task", "agent", "subagent"]),
        (
            ToolKind::Other,
            &["mcp__github__create_issue", "todowrite", "", "readme"],
        ),
    ];
    for (kind, names) in named {
        for name in names {
            for spelled in [name.to_string(), name.to_uppercase(), capitalised(name)] {
                assert_eq!(tool_kind(&call(&spelled, None)), kind, "{spelled:?}");
            }
        }
    }
}

fn capitalised(name: &str) -> String {
    let mut chars = name.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

#[test]
fn a_subagent_session_or_a_file_change_decides_the_kind_over_the_name() {
    let mut facts = call("Bash", None);
    facts.has_child_session = true;
    assert_eq!(tool_kind(&facts), ToolKind::Agent);

    let mut facts = call("mcp__fs__save", None);
    facts.changed_paths = vec!["/w/a.rs".to_owned()];
    assert_eq!(tool_kind(&facts), ToolKind::Edit);

    let mut facts = call("Bash", None);
    facts.changed_paths = vec!["/w/out.txt".to_owned()];
    assert_eq!(tool_kind(&facts), ToolKind::Edit, "a command that wrote");
}

#[test]
fn a_title_is_the_label_and_its_first_line() {
    let mut facts = call("Bash", input(&[("command", "npm test")]));
    facts.title = Some("  Run the tests\nin watch mode".to_owned());
    assert_eq!(tool_look(&facts).label, "Run the tests");
    facts.title = Some("   ".to_owned());
    assert_eq!(
        tool_look(&facts).label,
        "npm test",
        "a blank title says nothing"
    );
}

#[test]
fn a_command_is_its_label_and_kept_whole() {
    let multi = "cd app\nnpm test";
    for key in ["command", "cmd", "script"] {
        let look = look("Bash", &[(key, multi)]);
        assert_eq!(look.command.as_deref(), Some(multi), "{key}");
        assert_eq!(look.label, "cd app");
    }
    let bare = look("bash", &[]);
    assert_eq!((bare.command, bare.label.as_str()), (None, "bash"));
    let other = look("Read", &[("command", "x")]);
    assert_eq!(other.command, None, "only a command tool has a command");
}

#[test]
fn reads_and_edits_say_the_file_they_touched() {
    for key in ["file_path", "path", "filePath", "notebook_path", "file"] {
        let look = look("Read", &[(key, "/work/src/main.rs")]);
        assert_eq!(look.label, "Read main.rs", "{key}");
        assert_eq!(look.paths, ["/work/src/main.rs"]);
    }
    assert_eq!(
        look("Edit", &[("file_path", "/w/a.md")]).label,
        "Edited a.md"
    );
    assert_eq!(look("Read", &[]).label, "Read");

    let mut facts = call("write_file", None);
    facts.changed_paths = vec!["/w/new.ts".to_owned(), "/w/b.ts".to_owned()];
    let changed = tool_look(&facts);
    assert_eq!(changed.label, "Edited new.ts");
    assert_eq!(changed.paths, ["/w/new.ts", "/w/b.ts"]);
}

#[test]
fn the_other_kinds_say_what_they_were_given() {
    assert_eq!(look("Grep", &[("pattern", "TODO")]).label, "Searched TODO");
    assert_eq!(
        look("Glob", &[("glob", "*.rs"), ("path", "/w")]).label,
        "Searched *.rs"
    );
    assert_eq!(look("ls", &[("path", "/w")]).label, "Searched /w");
    assert_eq!(
        look("WebFetch", &[("url", "https://x.dev")]).label,
        "https://x.dev"
    );
    assert_eq!(
        look("WebSearch", &[("query", "rust uniffi")]).label,
        "rust uniffi"
    );
    assert_eq!(
        look(
            "Task",
            &[("description", "Find the bug"), ("prompt", "Look")]
        )
        .label,
        "Find the bug"
    );
    assert_eq!(look("task", &[]).label, "Subagent");
    assert_eq!(look("mcp__x__y", &[("query", "q")]).label, "mcp__x__y q");
    assert_eq!(look("mcp__x__y", &[]).label, "mcp__x__y");
}

#[test]
fn an_opened_row_names_the_kind_and_leaves_the_detail_to_say_the_rest() {
    let verbs: Vec<String> = ["bash", "read", "edit", "grep", "fetch", "task", "mcp__x__y"]
        .iter()
        .map(|name| look(name, &[]).verb)
        .collect();
    assert_eq!(
        verbs,
        [
            "Ran command",
            "Read file",
            "Edited file",
            "Searched",
            "Fetched",
            "Subagent",
            "mcp__x__y"
        ]
    );
}

fn tool(id: &str, kind: ToolKind, paths: &[&str]) -> FoldTool {
    FoldTool {
        id: id.to_owned(),
        kind,
        paths: paths.iter().map(|path| (*path).to_owned()).collect(),
    }
}

fn count(verb: FoldVerb, count: u32) -> FoldCount {
    FoldCount { verb, count }
}

#[test]
fn a_file_counts_once_and_an_edited_file_is_not_also_read() {
    let tools = [
        tool("1", ToolKind::Read, &["/a"]),
        tool("2", ToolKind::Read, &["/a"]),
        tool("3", ToolKind::Read, &["/b"]),
        tool("4", ToolKind::Edit, &["/b", "/c"]),
        tool("5", ToolKind::Edit, &["/c"]),
    ];
    assert_eq!(
        fold_counts(&tools),
        [count(FoldVerb::Edited, 2), count(FoldVerb::Read, 1)]
    );
}

#[test]
fn a_call_that_names_no_file_counts_as_one() {
    let tools = [
        tool("1", ToolKind::Read, &[]),
        tool("2", ToolKind::Read, &[]),
    ];
    assert_eq!(fold_counts(&tools), [count(FoldVerb::Read, 2)]);
}

#[test]
fn commands_searches_pages_and_subagents_count_per_call() {
    let tools = [
        tool("1", ToolKind::Command, &[]),
        tool("2", ToolKind::Command, &[]),
        tool("3", ToolKind::Search, &[]),
    ];
    assert_eq!(
        fold_counts(&tools),
        [count(FoldVerb::Ran, 2), count(FoldVerb::Searched, 1)]
    );
    let tools = [
        tool("1", ToolKind::Web, &[]),
        tool("2", ToolKind::Agent, &[]),
    ];
    assert_eq!(
        fold_counts(&tools),
        [count(FoldVerb::Fetched, 1), count(FoldVerb::Delegated, 1)]
    );
    assert_eq!(fold_counts(&[]), []);
}

#[test]
fn verbs_past_the_second_fold_into_used_and_other_calls_are_used_too() {
    let tools = [
        tool("1", ToolKind::Edit, &["/a"]),
        tool("2", ToolKind::Command, &[]),
        tool("3", ToolKind::Search, &[]),
        tool("4", ToolKind::Other, &[]),
        tool("5", ToolKind::Other, &[]),
    ];
    assert_eq!(
        fold_counts(&tools),
        [
            count(FoldVerb::Edited, 1),
            count(FoldVerb::Ran, 1),
            count(FoldVerb::Used, 3)
        ]
    );
    let only_other = [
        tool("1", ToolKind::Other, &[]),
        tool("2", ToolKind::Other, &[]),
    ];
    assert_eq!(fold_counts(&only_other), [count(FoldVerb::Used, 2)]);
    let two = [
        tool("1", ToolKind::Command, &[]),
        tool("2", ToolKind::Other, &[]),
    ];
    assert_eq!(
        fold_counts(&two),
        [count(FoldVerb::Ran, 1), count(FoldVerb::Used, 1)]
    );
}
