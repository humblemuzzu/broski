//! Code as lines of spans, each tagged with what it is (`TokenKind`), never with a colour: each app
//! colours the kinds by its own light and dark palettes.
//!
//! The grammars are the Sublime Text syntaxes vendored in `syntaxes/` (the languages agents and the
//! file viewer meet), parsed by syntect with the pure-Rust fancy-regex engine and loaded once on
//! first use. Highlighting is bounded by size, not
//! by a clock (which would colour the same file differently on a cold start): it stops at
//! `MAX_HIGHLIGHT_LINES`, `MAX_HIGHLIGHT_BYTES`, a line longer than `MAX_HIGHLIGHT_LINE_BYTES` or a
//! grammar error, and every line after that point is plain text. A regex that would backtrack
//! without end cannot hang a line either: fancy-regex gives up after a million steps, which syntect
//! takes as no match (`syntect` 5.3.0 `parsing/regex.rs`).

mod kinds;
mod languages;
#[cfg(test)]
mod tests;

use std::sync::OnceLock;

use syntect::parsing::{ParseState, ScopeStack, SyntaxReference, SyntaxSet};

pub use self::languages::{language_for_path, normalize_language};

pub const MAX_HIGHLIGHT_LINES: usize = 5_000;
pub const MAX_HIGHLIGHT_BYTES: usize = 512 * 1024;
/// Sublime Text, too, leaves lines this long uncoloured: a regex grammar is slow on them.
pub const MAX_HIGHLIGHT_LINE_BYTES: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TokenKind {
    Plain,
    Comment,
    Keyword,
    String,
    Number,
    /// `true`, `null`, a character literal, an escape, a language constant.
    Constant,
    Type,
    Function,
    /// A parameter, or `self`/`this`.
    Variable,
    /// A key of JSON, YAML, TOML or CSS.
    Property,
    Operator,
    Punctuation,
    /// An HTML or XML tag name.
    Tag,
    Attribute,
    /// A diff's added and removed lines.
    Inserted,
    Deleted,
    /// A markdown heading, a diff's hunk header.
    Heading,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeSpan {
    pub text: String,
    pub kind: TokenKind,
}

/// One line without its line break. Neighbouring spans differ in kind; an empty line has no span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeLine {
    pub spans: Vec<CodeSpan>,
}

/// The grammars of `syntaxes/`, compiled by the build script.
const SYNTAX_DUMP: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/syntaxes.packdump"));

fn syntaxes() -> &'static SyntaxSet {
    static SYNTAXES: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAXES.get_or_init(|| syntect::dumps::from_binary(SYNTAX_DUMP))
}

/// `code` in lines of spans. `language` is a fence label (`ts`, `bash`), a file extension or a
/// name `language_for_path` returned; an unknown or absent one makes every line plain.
pub fn highlight(code: &str, language: Option<&str>) -> Vec<CodeLine> {
    let syntaxes = syntaxes();
    let syntax = language.and_then(|language| languages::syntax_for(syntaxes, language));
    let mut lines = Vec::new();
    let mut rest = code;
    if let Some(syntax) = syntax {
        rest = highlight_lines(syntaxes, syntax, code, &mut lines);
    }
    lines.extend(split_lines(rest).map(plain_line));
    lines
}

/// Highlights `code` line by line until a bound stops it; returns the text not highlighted.
fn highlight_lines<'a>(
    syntaxes: &SyntaxSet,
    syntax: &SyntaxReference,
    code: &'a str,
    lines: &mut Vec<CodeLine>,
) -> &'a str {
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut offset = 0;
    for line in code.split_inclusive('\n') {
        let over = lines.len() >= MAX_HIGHLIGHT_LINES
            || offset + line.len() > MAX_HIGHLIGHT_BYTES
            || line.len() > MAX_HIGHLIGHT_LINE_BYTES;
        if over {
            break;
        }
        match kinds::spans(&mut state, &mut stack, syntaxes, line) {
            Some(spans) => lines.push(CodeLine { spans }),
            None => break,
        }
        offset += line.len();
    }
    &code[offset..]
}

fn split_lines(text: &str) -> impl Iterator<Item = &str> {
    text.split_inclusive('\n')
        .map(|line| line.strip_suffix('\n').unwrap_or(line))
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
}

fn plain_line(line: &str) -> CodeLine {
    let spans = if line.is_empty() {
        Vec::new()
    } else {
        vec![CodeSpan {
            text: line.to_owned(),
            kind: TokenKind::Plain,
        }]
    };
    CodeLine { spans }
}
