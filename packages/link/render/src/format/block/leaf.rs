//! What closing a block settles: a paragraph gives up its link reference definitions, a fence its
//! info string, indented code and HTML their trailing blank lines, a list its last line.

use std::collections::HashMap;

use super::tree::Kind;
use super::Parser;
use crate::format::inline::links::{
    link_destination, link_label, link_title, normalize_label, spaces_and_newline,
};

#[derive(Debug, Clone)]
pub(crate) struct Reference {
    pub destination: String,
    pub title: Option<String>,
}

/// Link reference definitions by normalised label; the first definition of a label wins.
#[derive(Default)]
pub(crate) struct RefMap(HashMap<String, Reference>);

impl RefMap {
    pub fn get(&self, label: &str) -> Option<&Reference> {
        self.0.get(&normalize_label(label))
    }
}

pub(super) fn finalize(parser: &mut Parser, node: usize) {
    let last_child_end = parser.nodes[node]
        .children
        .last()
        .map(|child| parser.nodes[*child].end_line);
    let block = &mut parser.nodes[node];
    match &mut block.kind {
        Kind::Paragraph => {
            strip_references(parser, node);
            if parser.nodes[node].text.trim().is_empty() {
                remove(parser, node);
            }
        }
        Kind::Code(code) => {
            if code.fence.is_some() {
                let (info, rest) = block.text.split_once('\n').unwrap_or((&block.text, ""));
                code.info = crate::format::inline::unescape(info.trim());
                block.text = rest.to_owned();
            } else {
                trim_blank_lines(&mut block.text, true);
            }
        }
        Kind::Html(_) => trim_blank_lines(&mut block.text, false),
        Kind::List(_) | Kind::Item(_) => {
            block.end_line = last_child_end.unwrap_or(block.start_line);
        }
        _ => {}
    }
}

fn remove(parser: &mut Parser, node: usize) {
    parser.nodes[node].kind = Kind::Removed;
    let parent = parser.nodes[node].parent;
    parser.nodes[parent].children.retain(|child| *child != node);
}

/// Trailing lines of only spaces, keeping one final line break when `keep_break`.
fn trim_blank_lines(text: &mut String, keep_break: bool) {
    let kept = text.trim_end_matches([' ', '\n']).len();
    let mut end = kept;
    while end < text.len() && text.as_bytes()[end] != b'\n' {
        end += 1;
    }
    text.truncate(end);
    if keep_break && !text.is_empty() {
        text.push('\n');
    }
}

/// Takes the link reference definitions off the start of a paragraph into the parser's map.
pub(super) fn strip_references(parser: &mut Parser, node: usize) {
    loop {
        let text = &parser.nodes[node].text;
        if !text.starts_with('[') {
            return;
        }
        let Some(used) = reference(text, &mut parser.refs) else {
            return;
        };
        let removed_lines = text[..used].matches('\n').count();
        let block = &mut parser.nodes[node];
        block.text.drain(..used);
        let dropped = removed_lines.min(block.line_starts.len());
        block.line_starts.drain(..dropped);
        if let Some(first) = block.line_starts.first() {
            block.start = *first;
        }
    }
}

/// One definition at the start of `text`: the bytes it takes, line break included.
fn reference(text: &str, refs: &mut RefMap) -> Option<usize> {
    let label_end = link_label(text)?;
    let label = &text[1..label_end - 1];
    let mut at = label_end;
    if text.as_bytes().get(at) != Some(&b':') {
        return None;
    }
    at += 1;
    at += spaces_and_newline(&text[at..]);
    let (destination, used) = link_destination(&text[at..])?;
    at += used;
    let before_title = at;
    let gap = spaces_and_newline(&text[at..]);
    let mut title = None;
    if gap > 0 {
        if let Some((parsed, used)) = link_title(&text[at + gap..]) {
            if let Some(end) = line_end(&text[at + gap + used..]) {
                title = Some(parsed);
                at += gap + used + end;
            }
        }
    }
    if title.is_none() {
        at = before_title + line_end(&text[before_title..])?;
    }
    let key = normalize_label(label);
    if key.is_empty() {
        return None;
    }
    refs.0.entry(key).or_insert(Reference {
        destination,
        title: title.filter(|title| !title.is_empty()),
    });
    Some(at)
}

/// Spaces or tabs to the end of the line: the bytes they take with the line break.
fn line_end(text: &str) -> Option<usize> {
    let spaces = text.len() - text.trim_start_matches([' ', '\t']).len();
    match text.as_bytes().get(spaces) {
        None => Some(spaces),
        Some(b'\n') => Some(spaces + 1),
        Some(_) => None,
    }
}
