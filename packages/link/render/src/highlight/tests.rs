use super::*;

/// The kind of the span whose text is exactly `token`, on any line.
fn kind_of(lines: &[CodeLine], token: &str) -> TokenKind {
    lines
        .iter()
        .flat_map(|line| &line.spans)
        .find(|span| span.text.trim() == token)
        .unwrap_or_else(|| panic!("no span {token:?} in {lines:?}"))
        .kind
}

fn text_of(lines: &[CodeLine]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.spans.iter().map(|span| span.text.as_str()).collect())
        .collect()
}

/// A language, a sample, and tokens of the sample with the kind each must have.
type Case = (
    &'static str,
    &'static str,
    &'static [(&'static str, TokenKind)],
);

#[test]
fn each_language_colours_its_tokens_by_kind() {
    let cases: &[Case] = &[
        (
            "rs",
            "fn main() { let x = 42; // done\n    \"hi\".to_owned() }",
            &[
                ("fn", TokenKind::Keyword),
                ("main", TokenKind::Function),
                ("42", TokenKind::Number),
                ("// done", TokenKind::Comment),
                ("\"hi\"", TokenKind::String),
            ],
        ),
        (
            "ts",
            "interface A { b: string }\nconst x: number = 1; // note\nfunction f(a) { return true }",
            &[
                ("interface", TokenKind::Keyword),
                ("A", TokenKind::Type),
                ("// note", TokenKind::Comment),
                ("true", TokenKind::Constant),
            ],
        ),
        (
            "tsx",
            "const v = <div className=\"a\">{x}</div>;",
            &[("div", TokenKind::Tag), ("className", TokenKind::Attribute), ("\"a\"", TokenKind::String)],
        ),
        (
            "python",
            "def f(a):\n    # why\n    return None",
            &[
                ("def", TokenKind::Keyword),
                ("f", TokenKind::Function),
                ("a", TokenKind::Variable),
                ("# why", TokenKind::Comment),
                ("None", TokenKind::Constant),
            ],
        ),
        (
            "bash",
            "echo hi # say it\nif true; then ls; fi",
            &[("echo", TokenKind::Function), ("# say it", TokenKind::Comment), ("fi", TokenKind::Keyword)],
        ),
        (
            "json",
            "{\"key\": \"value\", \"n\": 1, \"t\": true}",
            &[
                ("\"key\"", TokenKind::Property),
                ("\"value\"", TokenKind::String),
                ("1", TokenKind::Number),
                ("true", TokenKind::Constant),
            ],
        ),
        ("yaml", "name: broski\ncount: 3", &[("name", TokenKind::Property), ("3", TokenKind::Number)]),
        ("toml", "[package]\nname = \"x\"", &[("name", TokenKind::Property), ("\"x\"", TokenKind::String)]),
        (
            "swift",
            "func greet(name: String) -> String { return name }",
            &[("func", TokenKind::Keyword), ("String", TokenKind::Type), ("return", TokenKind::Keyword)],
        ),
        ("kotlin", "fun main() { val x = 1 }", &[("fun", TokenKind::Keyword), ("val", TokenKind::Keyword)]),
        ("go", "package main\nfunc main() { fmt.Println(\"x\") }", &[("func", TokenKind::Keyword), ("Println", TokenKind::Function)]),
        ("html", "<div class=\"a\">hi</div>", &[("div", TokenKind::Tag), ("class", TokenKind::Attribute)]),
        ("css", ".a { color: red; }", &[("color", TokenKind::Property), ("red", TokenKind::Constant)]),
        ("sql", "SELECT a FROM t WHERE b = 1", &[("SELECT", TokenKind::Keyword), ("1", TokenKind::Number)]),
        ("diff", "@@ -1 +1 @@\n-old\n+new", &[("old", TokenKind::Deleted), ("new", TokenKind::Inserted)]),
        ("dockerfile", "FROM rust:1\nRUN cargo build", &[("FROM", TokenKind::Keyword)]),
        ("java", "public class A { int x = 1; }", &[("class", TokenKind::Keyword), ("A", TokenKind::Type)]),
        ("c", "int main(void) { return 0; }", &[("main", TokenKind::Function), ("0", TokenKind::Number)]),
    ];
    for (language, code, expected) in cases {
        let lines = highlight(code, Some(language));
        assert_eq!(
            text_of(&lines),
            code.lines().collect::<Vec<_>>(),
            "{language}: the text is kept"
        );
        for (token, kind) in *expected {
            assert_eq!(kind_of(&lines, token), *kind, "{language}: {token}");
        }
    }
}

#[test]
fn fence_labels_and_paths_name_the_same_grammars() {
    let labels = [
        ("ts", "TypeScript"),
        ("tsx", "TypeScriptReact"),
        ("rs", "Rust"),
        ("py", "Python"),
        ("sh", "Bourne Again Shell (bash)"),
        ("zsh", "Bourne Again Shell (bash)"),
        ("shell", "Bourne Again Shell (bash)"),
        ("yml", "YAML"),
        ("kt", "Kotlin"),
        ("golang", "Go"),
        ("c++", "C++"),
        ("md", "Markdown"),
        ("patch", "Diff"),
        ("Dockerfile", "Dockerfile"),
        ("  JSON ", "JSON"),
    ];
    for (label, name) in labels {
        assert_eq!(normalize_language(label).as_deref(), Some(name), "{label}");
    }
    for label in ["text", "", "klingon"] {
        assert_eq!(normalize_language(label), None, "{label:?}");
    }
    let paths = [
        ("src/app.tsx", Some("TypeScriptReact")),
        ("/srv/x/Cargo.toml", Some("TOML")),
        ("Dockerfile", Some("Dockerfile")),
        ("build/Makefile", Some("Makefile")),
        ("a/b/script.SH", Some("Bourne Again Shell (bash)")),
        ("notes.txt", None),
        ("LICENSE", None),
    ];
    for (path, name) in paths {
        assert_eq!(language_for_path(path).as_deref(), name, "{path}");
    }
    let by_path = language_for_path("main.swift").expect("swift");
    let lines = highlight("let x = 1", Some(&by_path));
    assert_eq!(
        kind_of(&lines, "let"),
        TokenKind::Keyword,
        "a name from the path highlights"
    );
}

#[test]
fn an_unknown_language_is_plain_and_keeps_every_line() {
    let code = "first\n\n  third\r\nlast";
    let expected = |text: &str| CodeLine {
        spans: vec![CodeSpan {
            text: text.to_owned(),
            kind: TokenKind::Plain,
        }],
    };
    let lines = highlight(code, Some("klingon"));
    assert_eq!(
        lines,
        [
            expected("first"),
            CodeLine { spans: Vec::new() },
            expected("  third"),
            expected("last")
        ]
    );
    assert_eq!(highlight(code, None), lines);
}

#[test]
fn highlighting_stops_at_its_bounds_and_the_rest_is_plain() {
    let many = "let x = 1;\n".repeat(MAX_HIGHLIGHT_LINES + 10);
    let lines = highlight(&many, Some("rs"));
    assert_eq!(lines.len(), MAX_HIGHLIGHT_LINES + 10, "every line is kept");
    assert_eq!(
        kind_of(&lines[MAX_HIGHLIGHT_LINES - 1..MAX_HIGHLIGHT_LINES], "let"),
        TokenKind::Keyword
    );
    assert_eq!(
        lines[MAX_HIGHLIGHT_LINES].spans.len(),
        1,
        "past the bound: plain"
    );
    assert_eq!(lines[MAX_HIGHLIGHT_LINES].spans[0].kind, TokenKind::Plain);

    let long = format!(
        "let a = 1;\nlet b = \"{}\";\nlet c = 3;\n",
        "x".repeat(MAX_HIGHLIGHT_LINE_BYTES)
    );
    let lines = highlight(&long, Some("rs"));
    assert_eq!(kind_of(&lines[..1], "let"), TokenKind::Keyword);
    for line in &lines[1..] {
        assert_eq!(
            line.spans.len(),
            1,
            "a line too long, and every one after it, is plain"
        );
    }
}
