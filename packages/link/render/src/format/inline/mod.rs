//! Inlines (CommonMark §6) with GitHub's strikethrough and extended autolinks, footnote references
//! and TeX math: one pass over the text that leaves pieces of text, a delimiter stack for emphasis
//! and a bracket stack for links, as the spec's appendix describes; then emphasis is matched with
//! the spec's openers-bottom bound, so no input makes it quadratic.
//!
//! Matches are kept as ranges over the pieces rather than as a tree, and the pieces become styled
//! spans in one walk (`spans.rs`).

mod autolink;
mod brackets;
pub(crate) mod chars;
mod emphasis;
pub(crate) mod entities;
mod heal;
pub(crate) mod links;
mod math;
pub(crate) mod raw_html;
mod scan;
mod spans;
mod tags;

use std::collections::HashMap;

pub(crate) use autolink::linked_text;

use super::block::RefMap;
use super::model::{FormatLink, FormatSpan};

/// `text` (a paragraph's, a heading's or a cell's) as spans. With `streaming`, markup left open at
/// the end is closed rather than shown as written.
pub(crate) fn spans(text: &str, refs: &RefMap, streaming: bool) -> Vec<FormatSpan> {
    let text = text.trim_matches([' ', '\t', '\n']);
    let text = if streaming {
        heal::trim_dangling(text)
    } else {
        text
    };
    let mut inline = Inline::new(text, refs, streaming);
    inline.run();
    inline.process_emphasis(None);
    inline.hide_open_brackets();
    spans::flatten(inline)
}

/// Text with its backslash escapes and character references resolved: a link's destination and
/// title, a fence's info string.
pub(crate) fn unescape(text: &str) -> String {
    if !text.contains(['\\', '&']) {
        return text.to_owned();
    }
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while at < bytes.len() {
        let next = bytes.get(at + 1);
        if bytes[at] == b'\\' && next.is_some_and(u8::is_ascii_punctuation) {
            out.push(char::from(bytes[at + 1]));
            at += 2;
            continue;
        }
        if bytes[at] == b'&' {
            if let Some((found, used)) = entities::reference(&text[at..]) {
                out.push_str(&found);
                at += used;
                continue;
            }
        }
        let Some(character) = text[at..].chars().next() else {
            break;
        };
        out.push(character);
        at += character.len_utf8();
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Piece {
    Text,
    /// Text a delimiter or a bracket points at: never merged with its neighbours.
    Pinned,
    Code,
    Html,
    Math,
    Footnote,
}

pub(crate) struct Item {
    pub text: String,
    pub piece: Piece,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Style {
    Strong,
    Emphasis,
    Strike,
    Code,
}

/// A style over the pieces from `start` up to `end`.
pub(crate) struct Styled {
    pub start: usize,
    pub end: usize,
    pub style: Style,
}

pub(crate) struct Linked {
    pub start: usize,
    pub end: usize,
    pub link: FormatLink,
}

pub(crate) struct Delim {
    pub item: usize,
    pub ch: u8,
    pub count: usize,
    pub original: usize,
    pub can_open: bool,
    pub can_close: bool,
    /// Where the run starts in the text.
    pub at: usize,
    pub prev: Option<usize>,
    pub next: Option<usize>,
}

#[derive(Clone)]
pub(crate) struct Bracket {
    pub item: usize,
    /// The delimiter on top of the stack when the bracket opened: emphasis inside a link is matched
    /// down to it and no further.
    pub prev_delim: Option<usize>,
    pub image: bool,
    pub active: bool,
    /// Another bracket opened after this one, so its text cannot be a label.
    pub bracket_after: bool,
    /// Where the text inside the bracket starts.
    pub inside: usize,
}

pub(crate) struct Inline<'a> {
    pub text: &'a str,
    pub pos: usize,
    pub refs: &'a RefMap,
    pub streaming: bool,
    /// Where the text's last line starts: while streaming, only emphasis opened there is closed.
    pub last_line: usize,
    pub items: Vec<Item>,
    pub styles: Vec<Styled>,
    pub links: Vec<Linked>,
    pub delims: Vec<Delim>,
    pub top: Option<usize>,
    pub brackets: Vec<Bracket>,
    /// Style tags (`<kbd>`) still waiting for their closing tag: name and piece.
    pub open_tags: Vec<(String, usize)>,
    /// Backtick runs by length, each list in order of position; built on the first code span.
    pub backtick_runs: Option<HashMap<usize, Vec<usize>>>,
    /// Where a `$` could close inline math; built on the first `$`.
    pub dollar_closers: Option<Vec<usize>>,
    /// Each searched-for closer: where the last search started and what it found, so the same
    /// search never rescans the text.
    pub found_ahead: HashMap<&'static str, (usize, Option<usize>)>,
}

impl<'a> Inline<'a> {
    fn new(text: &'a str, refs: &'a RefMap, streaming: bool) -> Self {
        Inline {
            text,
            pos: 0,
            refs,
            streaming,
            last_line: text.rfind('\n').map_or(0, |at| at + 1),
            items: Vec::new(),
            styles: Vec::new(),
            links: Vec::new(),
            delims: Vec::new(),
            top: None,
            brackets: Vec::new(),
            open_tags: Vec::new(),
            backtick_runs: None,
            dollar_closers: None,
            found_ahead: HashMap::new(),
        }
    }

    pub fn push_text(&mut self, text: &str) {
        if let Some(last) = self.items.last_mut() {
            if last.piece == Piece::Text {
                last.text.push_str(text);
                return;
            }
        }
        self.push(text.to_owned(), Piece::Text);
    }

    pub fn push(&mut self, text: String, piece: Piece) -> usize {
        self.items.push(Item { text, piece });
        self.items.len() - 1
    }

    /// The first `needle` at or after `from`, remembered so later searches from further on reuse it.
    pub fn find_ahead(&mut self, needle: &'static str, from: usize) -> Option<usize> {
        if let Some(&(searched, found)) = self.found_ahead.get(needle) {
            let still_first = found.is_none_or(|at| at >= from);
            if searched <= from && still_first {
                return found;
            }
        }
        let found = self.text.get(from..)?.find(needle).map(|at| at + from);
        self.found_ahead.insert(needle, (from, found));
        found
    }
}
