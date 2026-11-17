use serde_json::{json, Value};

use super::*;

fn item(value: Value) -> TranscriptItem {
    serde_json::from_value(value).expect("a transcript item")
}

fn user(id: &str, text: &str) -> TranscriptItem {
    item(json!({"kind": "user_message", "id": id, "text": text, "attachments": []}))
}

fn agent(id: &str, block: &str, text: &str) -> TranscriptItem {
    item(json!({"kind": "block", "id": id, "messageId": "m", "block": block, "text": text}))
}

fn call(id: &str, name: &str, input: Value) -> TranscriptItem {
    item(json!({"kind": "tool_call", "id": id, "toolCallId": id, "name": name, "input": input}))
}

fn terms(sources: &DictationSources) -> Vec<String> {
    dictation_terms(sources)
}

#[test]
fn the_dictionary_and_the_project_come_first_in_order() {
    let sources = DictationSources {
        items: vec![user("u1", "Refactor `ChatModel` please")],
        cwd: Some("/Users/me/StudioProjects/broski/".to_owned()),
        dictionary: vec![
            "Zanzibar".to_owned(),
            " Ghostty ".to_owned(),
            "humblemuzzu".to_owned(),
        ],
        ..Default::default()
    };
    assert_eq!(
        terms(&sources),
        ["Zanzibar", "Ghostty", "broski", "ChatModel"]
    );
}

#[test]
fn the_conversation_gives_code_spans_identifiers_paths_and_commands() {
    let sources = DictationSources {
        items: vec![
            user("u1", "The Noise handshake with ML-KEM looks broken, check `link/session`"),
            agent("b1", "text", "I updated `useEffect` in **SessionView.tsx** and ran `bun test`.\n\n```rust\nlet tokio_runtime = 1;\n```"),
            call("c1", "Bash", json!({"command": "cargo clippy --workspace -- -D warnings"})),
            call("c2", "Edit", json!({"file_path": "/Users/me/broski/apps/ios/Sources/ChatModel.swift"})),
        ],
        ..Default::default()
    };
    let got = terms(&sources);
    for expected in [
        "ML-KEM",
        "useEffect",
        "SessionView.tsx",
        "SessionView",
        "bun test",
        "cargo",
        "cargo clippy",
        "--workspace",
        "ChatModel.swift",
        "ChatModel",
        "Noise",
    ] {
        assert!(
            got.iter().any(|term| term == expected),
            "{expected} missing from {got:?}"
        );
    }
    assert!(
        !got.iter().any(|term| term.contains("tokio_runtime")),
        "code blocks are skipped: {got:?}"
    );
    assert!(
        !got.iter().any(|term| term == "The" || term == "check"),
        "{got:?}"
    );
}

#[test]
fn newer_and_repeated_names_rank_above_older_ones() {
    let mut items = vec![user("old", "look at `OldThing`")];
    items.extend((0..40).map(|n| agent(&format!("b{n}"), "text", "nothing named here")));
    items.push(user("new", "look at `NewThing` and `NewThing` again"));
    let got = terms(&DictationSources {
        items,
        ..Default::default()
    });
    assert_eq!(got, ["NewThing", "OldThing"]);
}

#[test]
fn thinking_counts_for_less_than_the_answer() {
    let sources = DictationSources {
        items: vec![
            agent("t", "thinking", "maybe `ThoughtOf`"),
            agent("a", "text", "use `AnsweredWith`"),
        ],
        ..Default::default()
    };
    assert_eq!(terms(&sources), ["AnsweredWith", "ThoughtOf"]);
}

#[test]
fn git_and_the_folder_add_changed_files_branch_and_entries() {
    let git: GitStatusRead = serde_json::from_value(json!({
        "root": "/Users/me/broski",
        "branch": "fix/terminal-fixes",
        "staged": [{"path": "packages/link/voice/src/terms.rs", "change": "added"}],
        "unstaged": [{"path": "apps/ios/Sources/ComposerView.swift", "change": "modified"}],
        "untracked": ["docs/architecture/dictation.md"],
        "truncated": false
    }))
    .unwrap();
    let folder: FilesListed = serde_json::from_value(json!({
        "path": "/Users/me/broski",
        "entries": [
            {"name": "apps", "kind": "dir"},
            {"name": "packages", "kind": "dir"},
            {"name": ".github", "kind": "dir"},
            {"name": "AGENTS.md", "kind": "file"},
            {"name": "broski-link", "kind": "dir"}
        ]
    }))
    .unwrap();
    let got = terms(&DictationSources {
        git: Some(git),
        folder: Some(folder),
        ..Default::default()
    });
    for expected in [
        "fix/terminal-fixes",
        "terminal-fixes",
        "terms.rs",
        "ComposerView.swift",
        "ComposerView",
        "dictation.md",
        "AGENTS.md",
        "broski-link",
    ] {
        assert!(
            got.iter().any(|term| term == expected),
            "{expected} missing from {got:?}"
        );
    }
    for unwanted in ["apps", "packages", ".github", "main"] {
        assert!(
            !got.iter().any(|term| term == unwanted),
            "{unwanted} in {got:?}"
        );
    }
}

#[test]
fn never_more_than_the_limit_and_every_term_is_sendable() {
    let names: String = (0..300).map(|n| format!("`Name{n}` ")).collect();
    let long = "`".to_owned() + &"x".repeat(80) + "Y`";
    let sources = DictationSources {
        items: vec![user("u", &names), user("v", &long)],
        dictionary: vec!["a".to_owned(), "x".repeat(60), "fine word".to_owned()],
        ..Default::default()
    };
    let got = terms(&sources);
    assert_eq!(got.len(), MAX_TERMS);
    assert_eq!(got[0], "fine word");
    assert!(got.iter().all(|term| words::sendable(term)), "{got:?}");
}

#[test]
fn nothing_to_go_on_gives_nothing() {
    assert!(terms(&DictationSources::default()).is_empty());
}
