//! The words a modified line changed. A run of removed lines followed by a run of added lines is a
//! modification; its lines pair up in order, and each pair is diffed by tokens: words, runs of
//! whitespace, and every other character alone, so `count = 1;` → `count = 2;` marks the `1`.

use std::time::{Duration, Instant};

use similar::{capture_diff_slices_deadline, Algorithm, DiffTag};

use super::{DiffLine, DiffLineKind, DiffSegment, MAX_EMPHASIS_LINE_BYTES};

/// Below this share of its visible text in common with its partner, a line was rewritten rather
/// than edited, and marking nearly all of it would say nothing.
const MIN_SIMILARITY: f32 = 0.4;

/// How long one pair's diff may search for the smallest change; past it similar settles for a
/// coarser one.
const PAIR_BUDGET: Duration = Duration::from_millis(5);

pub(super) fn emphasize(lines: &mut [DiffLine]) {
    let mut at = 0;
    while at < lines.len() {
        let removed = run(lines, at, DiffLineKind::Removed);
        if removed == 0 {
            at += 1;
            continue;
        }
        let gap = run(lines, at + removed, DiffLineKind::NoNewline);
        let added_at = at + removed + gap;
        let added = run(lines, added_at, DiffLineKind::Added);
        for pair in 0..removed.min(added) {
            let (old, new) = lines.split_at_mut(added_at + pair);
            mark(&mut old[at + pair], &mut new[0]);
        }
        at = added_at + added;
    }
}

/// How many lines of `kind` start at `from`.
fn run(lines: &[DiffLine], from: usize, kind: DiffLineKind) -> usize {
    lines[from.min(lines.len())..]
        .iter()
        .take_while(|line| line.kind == kind)
        .count()
}

fn mark(old: &mut DiffLine, new: &mut DiffLine) {
    if old.text.len() > MAX_EMPHASIS_LINE_BYTES
        || new.text.len() > MAX_EMPHASIS_LINE_BYTES
        || old.text == new.text
    {
        return;
    }
    let (old_tokens, new_tokens) = (tokens(&old.text), tokens(&new.text));
    let deadline = Some(Instant::now() + PAIR_BUDGET);
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &old_tokens, &new_tokens, deadline);
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut same = 0;
    for op in ops {
        let (tag, old_range, new_range) = op.as_tag_tuple();
        let changed = tag != DiffTag::Equal;
        for token in &old_tokens[old_range] {
            push(&mut removed, token, changed);
            if !changed {
                same += visible(token);
            }
        }
        for token in &new_tokens[new_range] {
            push(&mut added, token, changed);
        }
    }
    let longer = visible(&old.text).max(visible(&new.text));
    if (same as f32) < MIN_SIMILARITY * longer as f32 {
        return;
    }
    old.segments = joined(removed);
    new.segments = joined(added);
}

/// Bytes that are not whitespace.
fn visible(text: &str) -> usize {
    text.chars()
        .filter(|c| !c.is_whitespace())
        .map(char::len_utf8)
        .sum()
}

#[derive(PartialEq)]
enum Class {
    Word,
    Space,
    Other,
}

fn class(c: char) -> Class {
    if c.is_alphanumeric() || c == '_' {
        Class::Word
    } else if c.is_whitespace() {
        Class::Space
    } else {
        Class::Other
    }
}

fn tokens(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        let joins = |next: char| class(c) != Class::Other && class(next) == class(c);
        if chars.peek().is_some_and(|&(_, next)| joins(next)) {
            continue;
        }
        let end = at + c.len_utf8();
        tokens.push(&text[start..end]);
        start = end;
    }
    tokens
}

fn push(segments: &mut Vec<DiffSegment>, text: &str, emphasized: bool) {
    match segments.last_mut() {
        Some(last) if last.emphasized == emphasized => last.text.push_str(text),
        _ => segments.push(DiffSegment {
            text: text.to_owned(),
            emphasized,
        }),
    }
}

/// Whitespace alone between two changed words is part of the change, so `a b` → `x y` marks one
/// stretch rather than two words; the segments are then merged again.
fn joined(segments: Vec<DiffSegment>) -> Vec<DiffSegment> {
    let emphasized = |at: usize| segments.get(at).is_some_and(|segment| segment.emphasized);
    let mut merged = Vec::with_capacity(segments.len());
    for (at, segment) in segments.iter().enumerate() {
        let between = at > 0 && emphasized(at - 1) && emphasized(at + 1);
        let blank = segment.text.trim().is_empty();
        push(
            &mut merged,
            &segment.text,
            segment.emphasized || (between && blank),
        );
    }
    if merged.iter().any(|segment| segment.emphasized) {
        merged
    } else {
        Vec::new()
    }
}
