//! A table's columns as the apps need them to choose a layout: alignment, whether the column holds
//! numbers, its longest cell and word, whether it is all short; and whether the table is a list of
//! labels and values.

use super::model::{ColumnAlign, FormatSpan, FormatTable, TableCell, TableColumn, TableShape};

/// A cell this short never needs to wrap.
const SHORT_CELL_CHARS: usize = 16;
/// The longest label a key/value table's first column may hold.
const KEY_CHARS: usize = 28;
const NUMBER_PREFIXES: [char; 12] = ['~', '≈', '<', '>', '±', '+', '-', '−', '$', '€', '£', '¥'];

/// The table with every row one cell per column, and each column analysed.
pub(crate) fn table(
    aligns: &[ColumnAlign],
    header: Vec<TableCell>,
    rows: Vec<Vec<TableCell>>,
) -> FormatTable {
    let width = aligns.len();
    let header = fit(header, width);
    let rows: Vec<Vec<TableCell>> = rows.into_iter().map(|row| fit(row, width)).collect();
    let columns: Vec<TableColumn> = aligns
        .iter()
        .enumerate()
        .map(|(index, align)| column(*align, &header[index], rows.iter().map(|row| &row[index])))
        .collect();
    let shape = if width == 2 && columns[0].longest_cell as usize <= KEY_CHARS {
        TableShape::KeyValue
    } else {
        TableShape::Grid
    };
    FormatTable {
        columns,
        header,
        rows,
        shape,
    }
}

fn fit(mut cells: Vec<TableCell>, width: usize) -> Vec<TableCell> {
    cells.truncate(width);
    cells.resize_with(width, || TableCell { spans: Vec::new() });
    cells
}

fn column<'a>(
    align: ColumnAlign,
    header: &TableCell,
    body: impl Iterator<Item = &'a TableCell>,
) -> TableColumn {
    let header_text = plain(&header.spans);
    let mut longest_cell = header_text.chars().count();
    let mut longest_word = longest_word_of(&header_text);
    let mut numbers = 0;
    let mut others = 0;
    for cell in body {
        let text = plain(&cell.spans);
        longest_cell = longest_cell.max(text.chars().count());
        longest_word = longest_word.max(longest_word_of(&text));
        if is_blank(&text) {
            continue;
        }
        if is_number(&text) {
            numbers += 1;
        } else {
            others += 1;
        }
    }
    TableColumn {
        align,
        numeric: numbers > 0 && others == 0,
        longest_cell: u32::try_from(longest_cell).unwrap_or(u32::MAX),
        longest_word: u32::try_from(longest_word).unwrap_or(u32::MAX),
        short: longest_cell <= SHORT_CELL_CHARS,
    }
}

pub(crate) fn plain(spans: &[FormatSpan]) -> String {
    spans.iter().map(|span| span.text.as_str()).collect()
}

/// An empty cell, or one that only says there is nothing (`—`, `-`, `n/a`).
fn is_blank(cell: &str) -> bool {
    matches!(cell.trim(), "" | "—" | "–" | "-" | "n/a" | "N/A")
}

fn longest_word_of(text: &str) -> usize {
    text.split_whitespace()
        .map(|word| word.chars().count())
        .max()
        .unwrap_or(0)
}

/// A number, maybe signed, approximate or a price, maybe with a unit: `1,024`, `~90 KB`, `0.2 ms`,
/// `12%`, `1.5x`.
fn is_number(cell: &str) -> bool {
    let text = cell.trim().trim_start_matches(NUMBER_PREFIXES).trim_start();
    let end = text
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, ',' | '.' | '_')))
        .unwrap_or(text.len());
    let number = &text[..end];
    if !number.starts_with(|c: char| c.is_ascii_digit()) || number.matches('.').count() > 1 {
        return false;
    }
    let unit = text[end..].trim_start();
    unit.is_empty()
        || matches!(unit, "%" | "x" | "×")
        || (unit.chars().count() <= 5 && unit.chars().all(|c| c.is_alphabetic() || c == '/'))
}
