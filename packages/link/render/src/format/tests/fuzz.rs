//! No input can break the formatter: random markdown-shaped text from a seeded generator (the
//! same every run) never panics, keeps output proportional to input and keeps earlier blocks'
//! keys while text is appended; inputs built to make a naive parser quadratic finish quickly.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use crate::format::format_markdown;
use crate::format::model::{FormatBlock, FormatContent};

/// Pieces agents' text is made of, and the ones that stress the parser's edges.
const PIECES: [&str; 64] = [
    "*",
    "**",
    "***",
    "_",
    "__",
    "~",
    "~~",
    "`",
    "``",
    "```",
    "~~~",
    "[",
    "]",
    "(",
    ")",
    "![",
    "<",
    ">",
    "&amp;",
    "&#x1F600;",
    "&bogus;",
    "\\",
    "#",
    "## ",
    "- ",
    "* ",
    "1. ",
    "7) ",
    "> ",
    "|",
    "| a | b |",
    "|---|:-:|",
    "$",
    "$$",
    "\\(",
    "\\)",
    "https://x.io/a_b",
    "www.a.io.",
    "a@b.co",
    "src/a.ts:1:2",
    "~/x/y.rs",
    "\n",
    "\n\n",
    "    ",
    "\t",
    " ",
    "word",
    "é",
    "مرحبا",
    "👨‍👩‍👧",
    "<div>",
    "<!--",
    "-->",
    "[^1]",
    "[x]: /u \"t\"",
    "`★ Insight ─────`",
    "`─────`",
    "> [!NOTE]",
    "***\n",
    "---",
    "===",
    "<br>",
    "<kbd>",
    "</kbd>",
];

struct Generator(u64);

impl Generator {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }

    fn text(&mut self) -> String {
        let pieces = self.below(160);
        (0..pieces)
            .map(|_| PIECES[self.below(PIECES.len())])
            .collect()
    }
}

fn drawn_bytes(blocks: &[FormatBlock]) -> usize {
    blocks
        .iter()
        .map(|block| match &block.content {
            FormatContent::Paragraph { spans } | FormatContent::Heading { spans, .. } => {
                spans.iter().map(|span| span.text.len()).sum()
            }
            FormatContent::Table { table } => table
                .header
                .iter()
                .chain(table.rows.iter().flatten())
                .flat_map(|cell| &cell.spans)
                .map(|span| span.text.len())
                .sum(),
            FormatContent::Code { code } => code.text.len(),
            FormatContent::Math { tex } => tex.len(),
            FormatContent::Html { text } => text.len(),
            FormatContent::Rule => 0,
        })
        .sum()
}

#[test]
fn random_markdown_never_panics_stays_bounded_and_keeps_keys_while_appended() {
    let mut generator = Generator(0x9E37_79B9_7F4A_7C15);
    for _ in 0..3_000 {
        let text = generator.text();
        let whole = format_markdown(&text, false);
        let lines = text.lines().count() + 1;
        assert!(
            whole.len() <= lines * 2,
            "{} blocks from {lines} lines: {text:?}",
            whole.len()
        );
        assert!(
            drawn_bytes(&whole) <= text.len() * 2 + 64,
            "output grew past its input: {text:?}"
        );
        let keys: HashSet<&str> = whole.iter().map(|block| block.key.as_str()).collect();
        assert_eq!(keys.len(), whole.len(), "keys repeat in {text:?}");
        let cut = text
            .char_indices()
            .map(|(at, _)| at)
            .nth(generator.below(text.chars().count().max(1)))
            .unwrap_or(0);
        let partial = format_markdown(&text[..cut], true);
        for index in 0..partial.len().saturating_sub(1) {
            assert_eq!(
                partial.get(index).map(|block| &block.key),
                whole.get(index).map(|block| &block.key),
                "block {index} moved when {:?} was appended to {:?}",
                &text[cut..],
                &text[..cut]
            );
        }
    }
}

#[test]
fn inputs_built_to_be_slow_finish_quickly() {
    let nested_images = format!("{}{}", "![".repeat(20_000), "](x)".repeat(20_000));
    let wide_table = format!(
        "|{}\n|{}\n|{}",
        "a|".repeat(5_000),
        "-|".repeat(5_000),
        "b|".repeat(5_000)
    );
    let cases = [
        ("deep quotes", format!("{}x", "> ".repeat(50_000))),
        ("deep list on one line", format!("{}x", "- ".repeat(30_000))),
        ("open brackets", "[".repeat(100_000)),
        ("emphasis runs", "*a ".repeat(60_000)),
        ("underscore runs", "_a_ __b".repeat(30_000)),
        (
            "unmatched backticks",
            (1..400).map(|n| "`".repeat(n) + "x").collect(),
        ),
        ("open comments", "<!-- ".repeat(50_000)),
        ("dollars", "$a ".repeat(60_000)),
        ("open math parens", "\\( ".repeat(50_000)),
        ("nested images", nested_images),
        ("wide table", wide_table),
        ("a mebibyte of lines", "a line of text\n".repeat(70_000)),
        ("links in a row", "[a](b) ".repeat(40_000)),
    ];
    for (name, text) in cases {
        for streaming in [false, true] {
            let start = Instant::now();
            let blocks = format_markdown(&text, streaming);
            let took = start.elapsed();
            assert!(took < Duration::from_secs(3), "{name}: {took:?}");
            assert!(
                drawn_bytes(&blocks) <= text.len() * 2 + 64,
                "{name}: output grew"
            );
        }
    }
}
