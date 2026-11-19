//! Syntax colouring for diff hunks, combined with word-level diff emphasis into each line's
//! `segments`.
//!
//! Each hunk's old view (`Context` + `Removed`) and new view (`Context` + `Added`) are lexed
//! separately through `@pierre/highlights`, so multiline comments and strings stay in sync across
//! edits without removed lines poisoning added lines.

use crate::highlight::{highlight, language_for_path, CodeLine, TokenKind};

use super::{DiffHunk, DiffLine, DiffLineKind, DiffSegment};

pub(super) fn colour(path: &str, previous_path: Option<&str>, hunks: &mut [DiffHunk]) {
    let language = language_for_path(path).or_else(|| previous_path.and_then(language_for_path));
    let Some(language) = language else {
        return;
    };
    for hunk in hunks {
        colour_hunk(&language, hunk);
    }
}

fn colour_hunk(language: &str, hunk: &mut DiffHunk) {
    let old_indices: Vec<usize> = hunk
        .lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            matches!(line.kind, DiffLineKind::Context | DiffLineKind::Removed).then_some(i)
        })
        .collect();
    let new_indices: Vec<usize> = hunk
        .lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| {
            matches!(line.kind, DiffLineKind::Context | DiffLineKind::Added).then_some(i)
        })
        .collect();

    let old_lines = highlight_subset(&hunk.lines, &old_indices, language);
    let new_lines = highlight_subset(&hunk.lines, &new_indices, language);

    for (&line_idx, syntax) in old_indices.iter().zip(&old_lines) {
        if hunk.lines[line_idx].kind == DiffLineKind::Removed {
            apply_syntax(&mut hunk.lines[line_idx], syntax);
        }
    }
    for (&line_idx, syntax) in new_indices.iter().zip(&new_lines) {
        apply_syntax(&mut hunk.lines[line_idx], syntax);
    }
}

fn highlight_subset(lines: &[DiffLine], indices: &[usize], language: &str) -> Vec<CodeLine> {
    if indices.is_empty() {
        return Vec::new();
    }
    let mut joined = String::new();
    for (pos, &idx) in indices.iter().enumerate() {
        if pos > 0 {
            joined.push('\n');
        }
        joined.push_str(&lines[idx].text);
    }
    highlight(&joined, Some(language))
}

/// Intersects `syntax`'s token spans with `line.segments`'s emphasis spans so every resulting
/// segment carries both its syntax `TokenKind` and its `emphasized` flag.
fn apply_syntax(line: &mut DiffLine, syntax: &CodeLine) {
    if syntax.spans.is_empty() {
        return;
    }
    let has_colour = syntax
        .spans
        .iter()
        .any(|span| span.kind != TokenKind::Plain);
    if !has_colour {
        return;
    }
    if line.segments.is_empty() {
        line.segments = syntax
            .spans
            .iter()
            .map(|span| DiffSegment {
                text: span.text.clone(),
                emphasized: false,
                kind: span.kind,
            })
            .collect();
        return;
    }
    line.segments = intersect(&line.segments, syntax);
}

fn intersect(emphasis: &[DiffSegment], syntax: &CodeLine) -> Vec<DiffSegment> {
    let mut out: Vec<DiffSegment> = Vec::with_capacity(emphasis.len().max(syntax.spans.len()));
    let mut e_idx = 0;
    let mut e_off = 0;
    let mut s_idx = 0;
    let mut s_off = 0;

    while e_idx < emphasis.len() && s_idx < syntax.spans.len() {
        let e = &emphasis[e_idx];
        let s = &syntax.spans[s_idx];
        let e_rem = e.text.len() - e_off;
        let s_rem = s.text.len() - s_off;
        let step = e_rem.min(s_rem);
        if step > 0 {
            let text = &e.text[e_off..e_off + step];
            push(&mut out, text, e.emphasized, s.kind);
        }
        e_off += step;
        s_off += step;
        if e_off == e.text.len() {
            e_idx += 1;
            e_off = 0;
        }
        if s_off == s.text.len() {
            s_idx += 1;
            s_off = 0;
        }
    }
    out
}

fn push(out: &mut Vec<DiffSegment>, text: &str, emphasized: bool, kind: TokenKind) {
    match out.last_mut() {
        Some(last) if last.emphasized == emphasized && last.kind == kind => {
            last.text.push_str(text)
        }
        _ => out.push(DiffSegment {
            text: text.to_owned(),
            emphasized,
            kind,
        }),
    }
}
