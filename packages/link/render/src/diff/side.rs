//! A hunk as rows for a wide screen: unchanged lines on both sides, a modification's removed and
//! added lines side by side in order, the longer run's extra lines against an empty side.

use super::{DiffHunk, DiffLine, DiffLineKind, SideBySideRow};

pub fn side_by_side(hunk: &DiffHunk) -> Vec<SideBySideRow> {
    let mut rows = Vec::with_capacity(hunk.lines.len());
    let mut removed: Vec<&DiffLine> = Vec::new();
    let mut added: Vec<&DiffLine> = Vec::new();
    for line in &hunk.lines {
        match line.kind {
            DiffLineKind::Removed if added.is_empty() => removed.push(line),
            DiffLineKind::Removed => {
                flush(&mut rows, &mut removed, &mut added);
                removed.push(line);
            }
            DiffLineKind::Added => added.push(line),
            DiffLineKind::Context => {
                flush(&mut rows, &mut removed, &mut added);
                rows.push(row(Some(line), Some(line)));
            }
            DiffLineKind::NoNewline => no_newline(&mut rows, &mut removed, &mut added, line),
        }
    }
    flush(&mut rows, &mut removed, &mut added);
    rows
}

/// The marker goes on the side of the line it is about: the last one read.
fn no_newline<'a>(
    rows: &mut Vec<SideBySideRow>,
    removed: &mut Vec<&'a DiffLine>,
    added: &mut Vec<&'a DiffLine>,
    line: &'a DiffLine,
) {
    if !added.is_empty() {
        added.push(line);
    } else if !removed.is_empty() {
        removed.push(line);
    } else {
        rows.push(row(Some(line), Some(line)));
    }
}

fn flush(rows: &mut Vec<SideBySideRow>, removed: &mut Vec<&DiffLine>, added: &mut Vec<&DiffLine>) {
    let count = removed.len().max(added.len());
    for at in 0..count {
        rows.push(row(removed.get(at).copied(), added.get(at).copied()));
    }
    removed.clear();
    added.clear();
}

fn row(left: Option<&DiffLine>, right: Option<&DiffLine>) -> SideBySideRow {
    SideBySideRow {
        left: left.cloned(),
        right: right.cloned(),
    }
}
