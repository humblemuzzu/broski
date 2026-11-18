//! Links and paths, prices and math: what a word in agent text opens, and what stays text.

use crate::format::format_markdown;
use crate::format::model::*;

fn spans(text: &str) -> Vec<FormatSpan> {
    match format_markdown(text, false).remove(0).content {
        FormatContent::Paragraph { spans } => spans,
        other => panic!("a paragraph, not {other:?}"),
    }
}

fn link(text: &str, shown: &str) -> FormatLink {
    spans(text)
        .into_iter()
        .find(|span| span.text == shown)
        .and_then(|span| span.link)
        .unwrap_or_else(|| panic!("{shown:?} is a link in {text:?}"))
}

fn linked(text: &str) -> Vec<String> {
    spans(text)
        .into_iter()
        .filter(|span| span.link.is_some())
        .map(|span| span.text)
        .collect()
}

#[test]
fn only_web_and_mail_links_open_and_a_relative_link_is_a_file() {
    assert_eq!(link("[a](https://x.io/p)", "a").kind, LinkKind::Web);
    assert_eq!(link("[a](mailto:me@x.io)", "a").kind, LinkKind::Mail);
    for refused in [
        "tel:+1555",
        "intent://scan",
        "file:///etc/hosts",
        "broski://pair?v=2",
        "javascript:alert(1)",
        "#top",
    ] {
        assert_eq!(
            link(&format!("[a]({refused})"), "a").kind,
            LinkKind::Inert,
            "{refused}"
        );
    }
    let file = link("[the contract](docs/contract.md:12)", "the contract");
    assert_eq!(
        file.kind,
        LinkKind::File {
            line: Some(12),
            column: None
        }
    );
    assert_eq!(file.target, "docs/contract.md");
}

#[test]
fn bare_urls_end_before_trailing_punctuation_and_long_ones_show_shortened() {
    assert_eq!(linked("see https://example.com."), ["https://example.com"]);
    assert_eq!(
        linked("(https://example.com/docs)"),
        ["https://example.com/docs"]
    );
    assert_eq!(
        linked("**https://example.com/bold**"),
        ["https://example.com/bold"]
    );
    assert_eq!(
        linked("on http://localhost:3000/app, then"),
        ["http://localhost:3000/app"]
    );
    let long =
        "https://github.com/example-org/example-app/blob/main/apps/web/src/components/ChatMarkdown.tsx";
    let shown = link(
        &format!("A bare URL: {long}"),
        "github.com/example-org/example-app/…/ChatMarkdown.tsx",
    );
    assert_eq!(shown.target, long, "the link keeps the whole URL");
    assert!(shown.bare);
    assert!(linked("in code `https://example.com` it is code").is_empty());
}

#[test]
fn paths_in_code_open_at_their_line_and_lookalikes_do_not() {
    let path = link("open `src/auth.ts:42:7` now", "src/auth.ts:42:7");
    assert_eq!(
        path.kind,
        LinkKind::File {
            line: Some(42),
            column: Some(7)
        }
    );
    assert_eq!(path.target, "src/auth.ts");
    assert_eq!(
        linked("keys in `~/.broski/link/bridge.key`"),
        ["~/.broski/link/bridge.key"]
    );
    assert_eq!(
        linked(r"on `C:\Users\dev\main.rs`"),
        [r"C:\Users\dev\main.rs"]
    );
    assert_eq!(linked("run `/usr/bin/env`"), ["/usr/bin/env"]);
    for not_a_path in [
        "`v1.2.3`",
        "`e.g.`",
        "`node.js`",
        "`1.5x`",
        "`/api/v1/stt`",
        "`/v1/chat/completions`",
        "and/or",
        "TCP/IP",
        "e.g./i.e.",
        "1/2",
    ] {
        assert!(
            linked(&format!("x {not_a_path} y")).is_empty(),
            "{not_a_path}"
        );
    }
}

#[test]
fn a_path_in_prose_stays_text_since_nothing_says_the_file_is_there() {
    for prose in [
        "edit packages/link/render/src/lib.rs, then",
        "see src/auth.ts:42 for it",
        "the route /api/v1/stt answers",
        "in @scope/pkg/docs/x.md",
    ] {
        assert!(linked(prose).is_empty(), "{prose}");
    }
    assert_eq!(
        linked("mail me@example.com or see example.com/docs"),
        ["me@example.com", "example.com/docs"]
    );
}

#[test]
fn prices_tildes_and_arithmetic_stay_text_and_math_is_tex() {
    let plain = |text: &str| {
        spans(text)
            .iter()
            .all(|span| !span.math && !span.strike && !span.emphasis)
    };
    assert!(plain("it costs $5 and $10, or $5–$10"));
    assert!(plain("about ~20ms, 20~25 items"));
    assert!(plain("2*3*4 = 24 and a * b * c"));
    let math: Vec<String> = spans("sort is $O(n \\log n)$ and \\(e^{i\\pi}\\)")
        .into_iter()
        .filter(|span| span.math)
        .map(|span| span.text)
        .collect();
    assert_eq!(math, ["O(n \\log n)", "e^{i\\pi}"]);
    let display = format_markdown("$$\n\\frac{a}{b}\n$$", false);
    assert_eq!(
        display[0].content,
        FormatContent::Math {
            tex: "\\frac{a}{b}".to_owned()
        }
    );
}

#[test]
fn a_host_named_without_its_scheme_opens_the_page_not_a_file() {
    for (text, word) in [
        (
            "see github.com/acme/app/blob/main/src/auth.ts for the fix",
            "github.com/acme/app/blob/main/src/auth.ts",
        ),
        (
            "docs at `docs.rs/syntect/5.3.0/syntect/`",
            "docs.rs/syntect/5.3.0/syntect/",
        ),
        ("example.com/index.html is up", "example.com/index.html"),
    ] {
        let found = link(text, word);
        assert_eq!(found.kind, LinkKind::Web, "{text}");
        assert_eq!(found.target, format!("https://{word}"));
    }
    let folder = link("open `src.v2/main.rs`", "src.v2/main.rs");
    assert!(
        matches!(folder.kind, LinkKind::File { .. }),
        "a dotted folder is still a path"
    );
}

#[test]
fn a_shells_variables_are_never_math() {
    for text in ["set PATH=$PATH:$HOME/bin", "echo $USER_NAME$x"] {
        assert!(spans(text).iter().all(|span| !span.math), "{text}");
    }
    assert!(spans("so $x$ is")
        .iter()
        .any(|span| span.math && span.text == "x"));
}
