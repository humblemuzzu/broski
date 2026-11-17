use super::*;

fn kinds(words: &[&str]) -> Vec<Option<Kind>> {
    words.iter().map(|word| classify(word)).collect()
}

#[test]
fn identifiers_files_and_flags_are_names() {
    assert_eq!(
        kinds(&[
            "useEffect",
            "SessionView",
            "SwiftUI",
            "XCFramework",
            "UniFFI",
            "snake_case",
            "ML-KEM",
            "x86_64",
            "k8s",
            "Qwen3",
            "GitHub",
            "macOS"
        ]),
        vec![Some(Kind::Identifier); 12]
    );
    assert_eq!(
        kinds(&["limits.ts", "Next.js", "Cargo.toml", "project.yml"]),
        vec![Some(Kind::File); 4]
    );
    assert_eq!(classify("--dangerously-skip-permissions"), Some(Kind::Flag));
    assert_eq!(classify("PTY"), Some(Kind::Acronym));
}

#[test]
fn english_numbers_and_syntax_are_not() {
    let plain = [
        "the",
        "Hello",
        "re-render",
        "e.g",
        "i.e",
        "0.3.325",
        "2024",
        "10ms",
        "4MiB",
        "3rd",
        "TODO",
        "a",
        "foo(bar)",
        "x=1",
        "https://x.ai",
        "-D",
        "--",
        "U.S",
        "OK",
    ];
    assert_eq!(kinds(&plain), vec![None; plain.len()]);
}

#[test]
fn prose_keeps_names_and_proper_nouns_inside_sentences() {
    let names =
        prose("Check the Postgres migration in limits.ts. Then rename isLoading, and ask Claude.");
    let words: Vec<&str> = names.iter().map(|(word, _)| word.as_str()).collect();
    assert_eq!(words, ["Postgres", "limits.ts", "isLoading", "Claude"]);
}

#[test]
fn a_word_after_a_full_stop_is_not_a_proper_noun() {
    assert!(prose("Done. Then we ship.").is_empty());
}

#[test]
fn trimming_drops_wrappers_calls_and_possessives() {
    assert_eq!(trim_token("(useEffect()),"), "useEffect");
    assert_eq!(trim_token("“SwiftUI’s"), "SwiftUI");
    assert_eq!(trim_token("`limits.ts`."), "limits.ts");
}

#[test]
fn a_path_gives_its_name_its_identifier_stem_and_a_short_relative_form() {
    assert_eq!(
        path_names("apps/ios/SessionView.swift"),
        [
            "SessionView.swift",
            "SessionView",
            "apps/ios/SessionView.swift"
        ]
    );
    assert_eq!(
        path_names("/Users/me/project/src/limits.ts/"),
        ["limits.ts"]
    );
    assert_eq!(
        path_names("contract/limits.ts"),
        ["limits.ts", "contract/limits.ts"]
    );
    assert!(path_names("/").is_empty());
    assert_eq!(path_names(".github"), Vec::<String>::new());
    assert_eq!(
        path_names("packages/broski-link"),
        ["broski-link", "packages/broski-link"]
    );
    assert!(
        path_names("src/").is_empty(),
        "a plain folder name is spelled right already"
    );
}

#[test]
fn a_code_span_is_kept_whole_when_short() {
    assert_eq!(code_span("bun test"), ["bun test"]);
    assert_eq!(code_span("zod"), ["zod"]);
    assert_eq!(code_span("useEffect()"), ["useEffect"]);
    assert_eq!(
        code_span("src/contract/limits.ts"),
        ["limits.ts", "src/contract/limits.ts"]
    );
    assert!(code_span("x = 1").is_empty());
}

#[test]
fn a_command_gives_its_programs_pairs_flags_and_files() {
    assert_eq!(
        command("RUST_LOG=debug cargo clippy --workspace -- -D warnings | head -5 && kubectl rollout restart deploy/api"),
        ["cargo", "cargo clippy", "--workspace", "kubectl", "kubectl rollout"]
    );
    assert!(command("cd /tmp && ls -la").is_empty());
}
