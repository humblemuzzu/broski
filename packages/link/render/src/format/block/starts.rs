//! What can open a block, tried in CommonMark's order with the extensions after the blocks they
//! must not shadow: tables last, as GitHub's own parser tries them.

use super::cursor::{is_space_or_tab, Cursor, CODE_INDENT};
use super::tree::{CodeData, Kind, MathData};
use super::{html, list_item, table, Parser, Started, MAX_DEPTH};
use crate::format::model::CalloutKind;

type Start = fn(&mut Parser, &mut Cursor, usize) -> Started;

/// Each start in order, and whether it opens a container (those are skipped past `MAX_DEPTH`).
const STARTS: [(Start, bool); 12] = [
    (quote, true),
    (insight, true),
    (atx_heading, false),
    (fence, false),
    (html_block, false),
    (setext_heading, false),
    (thematic_break, false),
    (list_item::list_item, true),
    (indented_code, false),
    (math, false),
    (footnote, true),
    (table_start, false),
];

impl Parser {
    pub(super) fn try_starts(&mut self, cursor: &mut Cursor, container: usize) -> Started {
        let deep = self.depth() >= MAX_DEPTH;
        for (start, opens_container) in STARTS {
            if deep && opens_container {
                continue;
            }
            match start(self, cursor, container) {
                Started::No => {}
                started => return started,
            }
        }
        Started::No
    }
}

fn quote(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented || cursor.peek_at(cursor.next_nonspace) != Some(b'>') {
        return Started::No;
    }
    let marker = parser.line_start + cursor.next_nonspace;
    cursor.advance_next_nonspace();
    cursor.advance(1, false);
    if is_space_or_tab(cursor.peek_at(cursor.offset)) {
        cursor.advance(1, true);
    }
    parser.close_unmatched();
    let kind = match alert(&cursor.line[cursor.offset..]) {
        Some(kind) => {
            cursor.skip_to_end();
            Kind::Callout(kind)
        }
        None => Kind::Quote,
    };
    parser.add_child(kind, marker);
    Started::Container
}

/// GitHub's alert marker, alone on a quote's first line: `[!NOTE]`, any case, or the bold
/// `**Note**` GitHub read before it.
fn alert(line: &str) -> Option<CalloutKind> {
    let line = line.trim();
    let inner = match line.strip_prefix("[!") {
        Some(rest) => rest.strip_suffix(']')?,
        None => line
            .strip_prefix("**")?
            .strip_suffix("**")?
            .trim_end_matches(':'),
    };
    match inner.to_ascii_uppercase().as_str() {
        "NOTE" => Some(CalloutKind::Note),
        "TIP" => Some(CalloutKind::Tip),
        "IMPORTANT" => Some(CalloutKind::Important),
        "WARNING" => Some(CalloutKind::Warning),
        "CAUTION" => Some(CalloutKind::Caution),
        _ => None,
    }
}

fn insight(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented || !opens_insight(cursor.rest()) {
        return Started::No;
    }
    parser.close_unmatched();
    parser.add_child(Kind::Insight, parser.line_start + cursor.next_nonspace);
    cursor.skip_to_end();
    Started::Leaf
}

/// `` `★ Insight ─────` `` as Claude Code opens its explanatory block, backticks optional.
fn opens_insight(rest: &str) -> bool {
    let line = rest.trim_end().trim_matches('`');
    let Some(after) = line.strip_prefix('★') else {
        return false;
    };
    let Some(rule) = after.trim_start().strip_prefix("Insight") else {
        return false;
    };
    let rule = rule.trim();
    rule.chars().count() >= 3 && rule.chars().all(|c| c == '─')
}

/// The insight block's closing rule: a run of `─`, backticks optional.
pub(super) fn closes_insight(rest: &str) -> bool {
    let line = rest.trim_end().trim_matches('`').trim();
    line.chars().count() >= 5 && line.chars().all(|c| c == '─')
}

fn atx_heading(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented {
        return Started::No;
    }
    let rest = cursor.rest().as_bytes();
    let hashes = rest.iter().take_while(|byte| **byte == b'#').count();
    if hashes == 0 || hashes > 6 || !matches!(rest.get(hashes), None | Some(b' ' | b'\t')) {
        return Started::No;
    }
    let start = parser.line_start + cursor.next_nonspace;
    cursor.advance_next_nonspace();
    cursor.advance(hashes, false);
    parser.close_unmatched();
    let level = u8::try_from(hashes).unwrap_or(6);
    let node = parser.add_child(Kind::Heading(level), start);
    parser.nodes[node].text = without_closing_hashes(&cursor.line[cursor.offset..]).to_owned();
    cursor.skip_to_end();
    Started::Leaf
}

/// A heading's text without its optional closing run of `#` (one preceded by a space or tab).
fn without_closing_hashes(text: &str) -> &str {
    let trimmed = text.trim_end_matches([' ', '\t']);
    let before = trimmed.trim_end_matches('#');
    if before.len() == trimmed.len() {
        return trimmed;
    }
    if before.is_empty() || before.ends_with([' ', '\t']) {
        return before.trim_end_matches([' ', '\t']);
    }
    trimmed
}

fn fence(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented {
        return Started::No;
    }
    let rest = cursor.rest();
    let Some(&marker) = rest.as_bytes().first() else {
        return Started::No;
    };
    if marker != b'`' && marker != b'~' {
        return Started::No;
    }
    let run = rest.bytes().take_while(|byte| *byte == marker).count();
    if run < 3 || (marker == b'`' && rest[run..].contains('`')) {
        return Started::No;
    }
    let indent = cursor.indent;
    let start = parser.line_start + cursor.next_nonspace;
    parser.close_unmatched();
    let code = CodeData {
        fence: Some((marker, run, indent)),
        info: String::new(),
        closed: false,
    };
    parser.add_child(Kind::Code(code), start);
    cursor.advance_next_nonspace();
    cursor.advance(run, false);
    Started::Leaf
}

/// A closing fence: at least as long as the opening one, of its character, nothing after it.
pub(super) fn closes_fence(rest: &str, marker: u8, length: usize) -> bool {
    let run = rest.bytes().take_while(|byte| *byte == marker).count();
    run >= length && rest[run..].trim_matches([' ', '\t']).is_empty()
}

fn html_block(parser: &mut Parser, cursor: &mut Cursor, container: usize) -> Started {
    if cursor.indented || cursor.peek_at(cursor.next_nonspace) != Some(b'<') {
        return Started::No;
    }
    let lazy_paragraph = !parser.all_closed
        && !cursor.blank
        && matches!(parser.nodes[parser.tip].kind, Kind::Paragraph);
    let in_paragraph = matches!(parser.nodes[container].kind, Kind::Paragraph) || lazy_paragraph;
    let Some(start) = html::start(cursor.rest(), in_paragraph) else {
        return Started::No;
    };
    parser.close_unmatched();
    parser.add_child(Kind::Html(start), parser.line_start + cursor.offset);
    Started::Leaf
}

fn setext_heading(parser: &mut Parser, cursor: &mut Cursor, container: usize) -> Started {
    if cursor.indented || !matches!(parser.nodes[container].kind, Kind::Paragraph) {
        return Started::No;
    }
    let rest = cursor.rest().trim_end_matches([' ', '\t']);
    let level = match rest.as_bytes().first() {
        Some(b'=') => 1,
        Some(b'-') => 2,
        _ => return Started::No,
    };
    if !rest.bytes().all(|byte| byte == rest.as_bytes()[0]) {
        return Started::No;
    }
    parser.close_unmatched();
    super::leaf::strip_references(parser, container);
    if parser.nodes[container].text.is_empty() {
        return Started::No;
    }
    parser.nodes[container].kind = Kind::Heading(level);
    cursor.skip_to_end();
    Started::Leaf
}

fn thematic_break(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented || !is_thematic_break(cursor.rest()) {
        return Started::No;
    }
    parser.close_unmatched();
    parser.add_child(Kind::Rule, parser.line_start + cursor.next_nonspace);
    cursor.skip_to_end();
    Started::Leaf
}

pub(crate) fn is_thematic_break(rest: &str) -> bool {
    let Some(&marker) = rest.as_bytes().first() else {
        return false;
    };
    if !matches!(marker, b'*' | b'-' | b'_') {
        return false;
    }
    let mut count = 0;
    for byte in rest.bytes() {
        match byte {
            b' ' | b'\t' => {}
            found if found == marker => count += 1,
            _ => return false,
        }
    }
    count >= 3
}

fn indented_code(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    let after_paragraph = matches!(parser.nodes[parser.tip].kind, Kind::Paragraph);
    if !cursor.indented || after_paragraph || cursor.blank {
        return Started::No;
    }
    cursor.advance(CODE_INDENT, true);
    parser.close_unmatched();
    let code = CodeData {
        fence: None,
        info: String::new(),
        closed: true,
    };
    parser.add_child(Kind::Code(code), parser.line_start + cursor.offset);
    Started::Leaf
}

/// `$$` or `\[` alone on a line opens display math; a whole line `$$ … $$` is one. Unclosed, a
/// finished text reads it as text, so a line starting with `$$5` never swallows what follows.
fn math(parser: &mut Parser, cursor: &mut Cursor, _: usize) -> Started {
    if cursor.indented {
        return Started::No;
    }
    let rest = cursor.rest().trim_end();
    let (opener, closer) = if rest.starts_with("$$") {
        ("$$", "$$")
    } else if rest.starts_with("\\[") {
        ("\\[", "\\]")
    } else {
        return Started::No;
    };
    let inner = &rest[opener.len()..];
    let whole_line = inner.len() > closer.len() && inner.ends_with(closer);
    if !inner.is_empty() && !whole_line {
        return Started::No;
    }
    if !whole_line && !parser.math_may_close(closer) {
        return Started::No;
    }
    let start = parser.line_start + cursor.next_nonspace;
    parser.close_unmatched();
    let data = MathData {
        closer,
        closed: whole_line,
    };
    let node = parser.add_child(Kind::Math(data), start);
    if whole_line {
        let tex = inner[..inner.len() - closer.len()].trim();
        parser.nodes[node].text = format!("{tex}\n");
    }
    cursor.skip_to_end();
    Started::Leaf
}

fn footnote(parser: &mut Parser, cursor: &mut Cursor, container: usize) -> Started {
    if cursor.indented || matches!(parser.nodes[container].kind, Kind::Paragraph) {
        return Started::No;
    }
    let Some((label, length)) = footnote_label(cursor.rest()) else {
        return Started::No;
    };
    let start = parser.line_start + cursor.next_nonspace;
    parser.close_unmatched();
    parser.add_child(Kind::Footnote(label), start);
    cursor.advance_next_nonspace();
    cursor.advance(length, false);
    Started::Container
}

/// `[^label]:` at a line's start: the label and the bytes the marker takes.
fn footnote_label(rest: &str) -> Option<(String, usize)> {
    let inner = rest.strip_prefix("[^")?;
    let end = inner.find(']')?;
    let label = &inner[..end];
    let valid = !label.is_empty() && label.len() <= 999 && !label.contains(char::is_whitespace);
    if !valid || !inner[end + 1..].starts_with(':') {
        return None;
    }
    Some((label.to_owned(), end + 4))
}

fn table_start(parser: &mut Parser, cursor: &mut Cursor, container: usize) -> Started {
    if cursor.indented || !matches!(parser.nodes[container].kind, Kind::Paragraph) {
        return Started::No;
    }
    let Some(aligns) = table::delimiter_row(cursor.rest()) else {
        return Started::No;
    };
    let paragraph = &parser.nodes[container];
    let header = paragraph.text.trim_end_matches('\n');
    let header = header.rsplit('\n').next().unwrap_or(header);
    let piped = header.contains('|') || cursor.rest().contains('|');
    if !piped || table::cells(header).len() != aligns.len() {
        return Started::No;
    }
    parser.close_unmatched();
    table::open(parser, container, aligns);
    cursor.skip_to_end();
    Started::Leaf
}
