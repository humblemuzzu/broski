//! GitHub's tables (GFM §4.10): a paragraph's last line becomes the header when the next line is a
//! delimiter row with as many cells; the rows follow until a blank line or another block.

use super::tree::{Kind, TableData};
use super::Parser;
use crate::format::model::ColumnAlign;

/// The alignment of each column a delimiter row (`|:---|---:|`) gives, or `None` for any other line.
pub(crate) fn delimiter_row(line: &str) -> Option<Vec<ColumnAlign>> {
    let cells = cells(line);
    if cells.is_empty() {
        return None;
    }
    cells.iter().map(|cell| alignment(cell)).collect()
}

fn alignment(cell: &str) -> Option<ColumnAlign> {
    let start = cell.starts_with(':');
    let end = cell.ends_with(':') && cell.len() > 1;
    let dashes = &cell[usize::from(start)..cell.len() - usize::from(end)];
    if dashes.is_empty() || !dashes.bytes().all(|byte| byte == b'-') {
        return None;
    }
    Some(match (start, end) {
        (true, true) => ColumnAlign::Center,
        (true, false) => ColumnAlign::Start,
        (false, true) => ColumnAlign::End,
        (false, false) => ColumnAlign::Auto,
    })
}

/// A row's cells, trimmed, split at pipes no backslash escapes; the leading and trailing pipes are
/// optional. Escaped pipes stay escaped: `cell_text` takes them out.
pub(crate) fn cells(line: &str) -> Vec<&str> {
    let line = line.trim_matches([' ', '\t']);
    let bytes = line.as_bytes();
    let mut cells = Vec::new();
    let mut start = 0;
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' => at += 1,
            b'|' => {
                cells.push(&line[start..at]);
                start = at + 1;
            }
            _ => {}
        }
        at += 1;
    }
    let trailing = start < line.len() || !line.ends_with('|') || line.ends_with("\\|");
    if trailing {
        cells.push(&line[start.min(line.len())..]);
    }
    if line.starts_with('|') && !cells.is_empty() {
        cells.remove(0);
    }
    cells
        .into_iter()
        .map(|cell| cell.trim_matches([' ', '\t']))
        .collect()
}

/// A cell's text for the inline parser: `\|` is a pipe, even inside code.
pub(crate) fn cell_text(cell: &str) -> String {
    cell.replace("\\|", "|")
}

/// Moves the paragraph's last line into a new table after it; the paragraph is the table when that
/// line was all it held.
pub(super) fn open(parser: &mut Parser, paragraph: usize, aligns: Vec<ColumnAlign>) {
    let line_number = parser.line_number;
    let node = &mut parser.nodes[paragraph];
    let text = node.text.trim_end_matches('\n');
    let (before, header) = match text.rfind('\n') {
        Some(at) => (&text[..at], &text[at + 1..]),
        None => ("", text),
    };
    let data = TableData {
        aligns,
        header: header.trim().to_owned(),
        rows: Vec::new(),
    };
    let header_start = node.line_starts.pop().unwrap_or(node.start);
    if before.is_empty() {
        node.kind = Kind::Table(data);
        node.text.clear();
        node.start = header_start;
        return;
    }
    node.text = format!("{before}\n");
    parser.finalize(paragraph, line_number.saturating_sub(2));
    let table = parser.add_child(Kind::Table(data), header_start);
    parser.nodes[table].start_line = line_number.saturating_sub(1);
}
