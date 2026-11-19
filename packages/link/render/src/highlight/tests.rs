use super::generated::{
    CANONICAL_LANGUAGES, HIGHLIGHTS_VERSION, HIGHLIGHTS_WASM_SHA256, LANGUAGES, TOKEN_TYPES,
    WABT_VERSION,
};
use super::kinds::is_known_token_name;
use super::languages::language_id;
use super::*;

/// The kind of the span covering `token` (either exact trimmed text or as a token inside a merged
/// same-kind span such as `"public class "`), on any line.
fn kind_of(lines: &[CodeLine], token: &str) -> TokenKind {
    lines
        .iter()
        .flat_map(|line| &line.spans)
        .find(|span| {
            let trimmed = span.text.trim();
            trimmed == token || trimmed.split_whitespace().any(|word| word == token)
        })
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
            &[
                ("div", TokenKind::Tag),
                ("className", TokenKind::Attribute),
                ("\"a\"", TokenKind::String),
            ],
        ),
        (
            "js",
            "const f = (a) => { /* note */ return 'ok'; };",
            &[
                ("const", TokenKind::Keyword),
                ("/* note */", TokenKind::Comment),
                ("'ok'", TokenKind::String),
            ],
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
            &[
                ("# say it", TokenKind::Comment),
                ("if", TokenKind::Keyword),
                ("fi", TokenKind::Keyword),
            ],
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
        (
            "yaml",
            "name: broski\ncount: 3",
            &[("name", TokenKind::Property), ("3", TokenKind::Number)],
        ),
        (
            "toml",
            "[package]\nname = \"x\"",
            &[("name", TokenKind::Property), ("\"x\"", TokenKind::String)],
        ),
        (
            "swift",
            "func greet(name: String) -> String { return name }",
            &[
                ("func", TokenKind::Keyword),
                ("String", TokenKind::Type),
                ("return", TokenKind::Keyword),
            ],
        ),
        (
            "kotlin",
            "fun main() { val x = 1 }",
            &[("fun", TokenKind::Keyword), ("val", TokenKind::Keyword)],
        ),
        (
            "go",
            "package main\nfunc main() { fmt.Println(\"x\") }",
            &[
                ("func", TokenKind::Keyword),
                ("Println", TokenKind::Function),
            ],
        ),
        (
            "html",
            "<div class=\"a\">hi</div>",
            &[("div", TokenKind::Tag), ("class", TokenKind::Attribute)],
        ),
        (
            "css",
            ".a { color: red; }",
            &[("color", TokenKind::Property)],
        ),
        (
            "sql",
            "SELECT a FROM t WHERE b = 1",
            &[("SELECT", TokenKind::Keyword), ("1", TokenKind::Number)],
        ),
        (
            "diff",
            "@@ -1 +1 @@\n-old\n+new",
            &[("old", TokenKind::Deleted), ("new", TokenKind::Inserted)],
        ),
        (
            "dockerfile",
            "FROM rust:1\nRUN cargo build",
            &[("FROM", TokenKind::Keyword)],
        ),
        (
            "java",
            "public class A { int x = 1; }",
            &[("class", TokenKind::Keyword), ("A", TokenKind::Type)],
        ),
        (
            "c",
            "int main(void) { return 0; }",
            &[("main", TokenKind::Function), ("0", TokenKind::Number)],
        ),
        (
            "cpp",
            "class Foo { public: int x = 42; }; // ok",
            &[
                ("class", TokenKind::Keyword),
                ("42", TokenKind::Number),
                ("// ok", TokenKind::Comment),
            ],
        ),
        (
            "csharp",
            "public class A { int x = 1; // hi\n}",
            &[("class", TokenKind::Keyword), ("// hi", TokenKind::Comment)],
        ),
        (
            "ruby",
            "def hi\n  # note\n  \"yo\"\nend",
            &[
                ("def", TokenKind::Keyword),
                ("# note", TokenKind::Comment),
                ("\"yo\"", TokenKind::String),
            ],
        ),
        (
            "lua",
            "local x = 1 -- note\nreturn \"a\"",
            &[
                ("local", TokenKind::Keyword),
                ("-- note", TokenKind::Comment),
                ("\"a\"", TokenKind::String),
            ],
        ),
        (
            "dart",
            "void main() { final s = 'hi'; // ok\n}",
            &[
                ("final", TokenKind::Keyword),
                ("'hi'", TokenKind::String),
                ("// ok", TokenKind::Comment),
            ],
        ),
        (
            "groovy",
            "def x = 1 // note\nprintln 'hi'",
            &[("def", TokenKind::Keyword), ("// note", TokenKind::Comment)],
        ),
        (
            "objc",
            "@interface A : NSObject\n// note\n@end",
            &[("// note", TokenKind::Comment)],
        ),
        (
            "xml",
            "<root attr=\"1\"><!-- note --></root>",
            &[
                ("root", TokenKind::Tag),
                ("attr", TokenKind::Attribute),
                ("<!-- note -->", TokenKind::Comment),
            ],
        ),
        (
            "makefile",
            "# build\nall:\n\techo hi",
            &[("# build", TokenKind::Comment)],
        ),
        (
            "markdown",
            "# Title\n\nHello **world**",
            &[("# Title", TokenKind::Heading)],
        ),
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
fn fence_labels_and_paths_name_the_same_languages() {
    let labels = [
        ("ts", "TypeScript"),
        ("tsx", "TSX"),
        ("rs", "Rust"),
        ("py", "Python"),
        ("sh", "Shell"),
        ("zsh", "Shell"),
        ("shell", "Shell"),
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
        ("src/app.tsx", Some("TSX")),
        ("/srv/x/Cargo.toml", Some("TOML")),
        ("Dockerfile", Some("Dockerfile")),
        ("build/Makefile", Some("Makefile")),
        ("a/b/script.SH", Some("Shell")),
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
fn every_supported_language_round_trips_its_display_name() {
    for (id, canonical) in CANONICAL_LANGUAGES.iter().enumerate().skip(1) {
        let display = normalize_language(canonical).unwrap_or_else(|| {
            panic!("canonical language {canonical:?} (id {id}) did not resolve")
        });
        assert_eq!(
            language_id(&display),
            Some(id as u8),
            "display name {display:?} for {canonical:?} must round-trip to id {id}"
        );
    }
    assert!(
        LANGUAGES.windows(2).all(|pair| pair[0].0 < pair[1].0),
        "LANGUAGES must stay strictly sorted for binary search"
    );
}

#[test]
fn unicode_surrogates_cjk_and_crlf_keep_exact_text_and_tokens() {
    let code = "let café = \"🚀 日本語\"; // —ok\r\nlet π = 3.14;\r\n";
    let lines = highlight(code, Some("rs"));
    assert_eq!(
        text_of(&lines),
        ["let café = \"🚀 日本語\"; // —ok", "let π = 3.14;"]
    );
    assert_eq!(kind_of(&lines, "let"), TokenKind::Keyword);
    assert_eq!(kind_of(&lines, "\"🚀 日本語\""), TokenKind::String);
    assert_eq!(kind_of(&lines, "// —ok"), TokenKind::Comment);
    assert_eq!(kind_of(&lines, "3.14"), TokenKind::Number);
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
    assert!(highlight("", Some("rs")).is_empty());
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

#[test]
fn every_pierre_token_type_is_mapped_and_vendor_banner_matches_generated_tables() {
    for &name in TOKEN_TYPES {
        assert!(
            is_known_token_name(name),
            "unmapped @pierre/highlights token type {name:?}; update kinds.rs"
        );
    }
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let expected = format!(
        "@pierre/highlights {HIGHLIGHTS_VERSION} (highlights.wasm sha256 {HIGHLIGHTS_WASM_SHA256}) with wabt {WABT_VERSION}"
    );
    for file in [
        "vendor/highlights/highlights.c",
        "vendor/highlights/highlights.h",
    ] {
        let first_line = std::fs::read_to_string(root.join(file))
            .unwrap_or_else(|err| panic!("read {file}: {err}"))
            .lines()
            .next()
            .unwrap_or("")
            .to_owned();
        assert!(
            first_line.contains(&expected),
            "{file} banner is stale: {first_line:?} does not contain {expected:?}. Run scripts/generate-highlights.sh."
        );
    }
}
