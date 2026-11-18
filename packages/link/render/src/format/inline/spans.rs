//! The pass's pieces and ranges as styled spans: each piece's styles counted from the ranges that
//! start and end around it, its link the innermost one over it, an image's pieces folded into
//! its alt text, then addresses and pages in the plain text linked, and a code span that names a
//! file made a path.

use super::autolink::{bare_links, host_link};
use super::{Inline, Piece, Style};
use crate::format::links::{is_path, path_link};
use crate::format::model::{FormatLink, FormatSpan};

pub(super) fn flatten(inline: Inline) -> Vec<FormatSpan> {
    let count = inline.items.len();
    let mut depth = vec![[0i32; 4]; count + 1];
    for range in &inline.styles {
        let slot = style_slot(range.style);
        depth[range.start.min(count)][slot] += 1;
        depth[range.end.min(count)][slot] -= 1;
    }
    let link_of = innermost_links(&inline, count);
    let mut spans: Vec<FormatSpan> = Vec::new();
    let mut active = [0i32; 4];
    let mut index = 0;
    while index < count {
        for slot in 0..4 {
            active[slot] += depth[index][slot];
        }
        let link = link_of[index].map(|which| &inline.links[which]);
        let mut span = styled(&active);
        if let Some(range) = link.filter(|range| range.link.image) {
            span.text = alt_text(&inline, index, range.end);
            span.link = Some(range.link.clone());
            for skipped in &depth[index + 1..range.end.min(count).max(index + 1)] {
                for (slot, change) in skipped.iter().enumerate() {
                    active[slot] += change;
                }
            }
            index = range.end.max(index + 1);
            push(&mut spans, span);
            continue;
        }
        let item = &inline.items[index];
        span.text.clone_from(&item.text);
        span.link = link.map(|range| range.link.clone());
        mark_piece(&mut span, &item.piece, &item.text);
        push(&mut spans, span);
        index += 1;
    }
    link_bare(spans)
}

fn style_slot(style: Style) -> usize {
    match style {
        Style::Strong => 0,
        Style::Emphasis => 1,
        Style::Strike => 2,
        Style::Code => 3,
    }
}

fn styled(active: &[i32; 4]) -> FormatSpan {
    FormatSpan {
        strong: active[0] > 0,
        emphasis: active[1] > 0,
        strike: active[2] > 0,
        code: active[3] > 0,
        ..FormatSpan::default()
    }
}

fn mark_piece(span: &mut FormatSpan, piece: &Piece, text: &str) {
    match piece {
        Piece::Text | Piece::Pinned => {}
        Piece::Code => span.code = true,
        Piece::Html => span.html = true,
        Piece::Math => span.math = true,
        Piece::Footnote => {
            span.link = Some(FormatLink {
                kind: crate::format::model::LinkKind::Footnote,
                target: text.to_owned(),
                title: None,
                image: false,
                bare: false,
            });
        }
    }
}

/// For each piece, the link range nearest around it. Ranges are made innermost first, so each
/// piece takes the first range that covers it, except that an image takes all of its pieces (its
/// alt text is plain); a skip list keeps nested images linear.
fn innermost_links(inline: &Inline, count: usize) -> Vec<Option<usize>> {
    let mut link_of = vec![None; count];
    let mut next_free: Vec<usize> = (0..=count).collect();
    let images = inline
        .links
        .iter()
        .enumerate()
        .filter(|(_, range)| range.link.image);
    let others = inline
        .links
        .iter()
        .enumerate()
        .filter(|(_, range)| !range.link.image);
    for (which, range) in images.chain(others) {
        let end = range.end.min(count);
        let mut at = find(&mut next_free, range.start.min(count));
        while at < end {
            link_of[at] = Some(which);
            next_free[at] = at + 1;
            at = find(&mut next_free, at + 1);
        }
    }
    link_of
}

fn find(next_free: &mut [usize], at: usize) -> usize {
    let mut root = at;
    while next_free[root] != root {
        root = next_free[root];
    }
    let mut walk = at;
    while next_free[walk] != root {
        let next = next_free[walk];
        next_free[walk] = root;
        walk = next;
    }
    root
}

/// An image's description: the plain text of everything between its brackets.
fn alt_text(inline: &Inline, start: usize, end: usize) -> String {
    inline.items[start..end.min(inline.items.len())]
        .iter()
        .map(|item| item.text.as_str())
        .collect()
}

fn push(spans: &mut Vec<FormatSpan>, span: FormatSpan) {
    let image = span.link.as_ref().is_some_and(|link| link.image);
    if span.text.is_empty() && !image {
        return;
    }
    if let Some(last) = spans.last_mut() {
        if same_style(last, &span) {
            last.text.push_str(&span.text);
            return;
        }
    }
    spans.push(span);
}

fn same_style(a: &FormatSpan, b: &FormatSpan) -> bool {
    a.strong == b.strong
        && a.emphasis == b.emphasis
        && a.strike == b.strike
        && a.code == b.code
        && a.math == b.math
        && a.html == b.html
        && a.link == b.link
}

/// Links the addresses and pages in plain spans, and a code span that is a path as a whole: the
/// agent marked it as a name, so it opens the file, drawn as a path rather than as a link.
fn link_bare(spans: Vec<FormatSpan>) -> Vec<FormatSpan> {
    let mut out = Vec::with_capacity(spans.len());
    for span in spans {
        if span.link.is_some() || span.math || span.html {
            out.push(span);
            continue;
        }
        if span.code {
            let mut span = span;
            span.link = host_link(&span.text)
                .or_else(|| is_path(&span.text).then(|| path_link(&span.text, true)));
            out.push(span);
            continue;
        }
        let found = bare_links(&span.text, false);
        if found.is_empty() {
            out.push(span);
            continue;
        }
        let mut at = 0;
        for bare in found {
            push(&mut out, piece_of(&span, &span.text[at..bare.start]));
            let mut linked = piece_of(&span, &span.text[bare.start..bare.end]);
            linked.link = Some(bare.link);
            out.push(linked);
            at = bare.end;
        }
        push(&mut out, piece_of(&span, &span.text[at..]));
    }
    out
}

/// Part of a plain span in its style, without copying the whole span's text.
fn piece_of(span: &FormatSpan, text: &str) -> FormatSpan {
    FormatSpan {
        text: text.to_owned(),
        strong: span.strong,
        emphasis: span.emphasis,
        strike: span.strike,
        ..FormatSpan::default()
    }
}
