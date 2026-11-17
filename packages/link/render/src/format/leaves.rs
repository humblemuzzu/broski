//! A leaf block's content as the apps draw it, and the repairs to the one still streaming.

use super::block::tree::{Kind, Node, TableData};
use super::block::RefMap;
use super::inline;
use super::model::{FormatCode, FormatContent, FormatTable, TableCell};
use super::tables;

/// Fence languages whose text reads as prose: it wraps rather than scrolling sideways.
const PROSE_LANGUAGES: [&str; 8] = [
    "text",
    "txt",
    "plain",
    "plaintext",
    "markdown",
    "md",
    "log",
    "output",
];

/// The key's kind and the content of `node`; none for a leaf with nothing to show yet.
pub(crate) fn content(
    node: &Node,
    refs: &RefMap,
    streaming: bool,
    task: bool,
) -> Option<(&'static str, FormatContent)> {
    Some(match &node.kind {
        Kind::Paragraph => {
            let text = paragraph_text(&node.text, streaming, task)?;
            let spans = inline::spans(text, refs, streaming);
            if spans.is_empty() && streaming {
                return None;
            }
            ("p", FormatContent::Paragraph { spans })
        }
        Kind::Heading(level) => (
            "h",
            FormatContent::Heading {
                level: *level,
                spans: inline::spans(&node.text, refs, streaming),
            },
        ),
        Kind::Code(code) => (
            "code",
            FormatContent::Code {
                code: code_block(node, code),
            },
        ),
        Kind::Table(table) => (
            "table",
            FormatContent::Table {
                table: table_content(table, refs, streaming),
            },
        ),
        Kind::Math(_) => (
            "math",
            FormatContent::Math {
                tex: node.text.trim().to_owned(),
            },
        ),
        Kind::Html(_) => (
            "html",
            FormatContent::Html {
                text: node.text.trim_end_matches('\n').to_owned(),
            },
        ),
        Kind::Rule => ("rule", FormatContent::Rule),
        _ => return None,
    })
}

/// A paragraph's text to parse: without its task marker, and while streaming without trailing
/// rows of a table whose delimiter row has not arrived (a table is not a table until it does).
fn paragraph_text(text: &str, streaming: bool, task: bool) -> Option<&str> {
    let text = if task {
        without_task_marker(text)
    } else {
        text
    };
    if !streaming {
        return Some(text);
    }
    let body = text.trim_end_matches('\n');
    let mut end = body.len();
    loop {
        let line_start = body[..end].rfind('\n').map_or(0, |at| at + 1);
        if !body[line_start..end].trim_start().starts_with('|') {
            return Some(&body[..end]);
        }
        if line_start == 0 {
            return None;
        }
        end = line_start - 1;
    }
}

/// `[ ]`, `[x]` or `[X]` then a space, a tab or the end: whether the task is checked.
pub(crate) fn task_marker(text: &str) -> Option<bool> {
    let bytes = text.as_bytes();
    if bytes.len() < 3 || bytes[0] != b'[' || bytes[2] != b']' {
        return None;
    }
    if !matches!(bytes.get(3), None | Some(b' ' | b'\t' | b'\n')) {
        return None;
    }
    match bytes[1] {
        b' ' => Some(false),
        b'x' | b'X' => Some(true),
        _ => None,
    }
}

fn without_task_marker(text: &str) -> &str {
    text.get(3..).unwrap_or_default()
}

fn code_block(node: &Node, code: &super::block::tree::CodeData) -> FormatCode {
    let mut words = code.info.split_whitespace();
    let language = words.next().map(str::to_owned);
    let file = words
        .next()
        .filter(|word| looks_like_file(word))
        .map(str::to_owned);
    let prose = code.fence.is_some()
        && language.as_deref().is_none_or(|language| {
            PROSE_LANGUAGES.contains(&language.to_ascii_lowercase().as_str())
        });
    FormatCode {
        language,
        file,
        text: node
            .text
            .strip_suffix('\n')
            .unwrap_or(&node.text)
            .to_owned(),
        closed: code.closed,
        prose,
    }
}

/// A fence's second word names a file when it has a dot or a slash and no attribute syntax.
fn looks_like_file(word: &str) -> bool {
    word.contains(['.', '/']) && !word.contains(['=', '{', '}', '"', '\''])
}

/// A table's cells parsed; while streaming, the last row may still be arriving.
fn table_content(table: &TableData, refs: &RefMap, streaming: bool) -> FormatTable {
    let header = cells(&table.header, refs, false);
    let last = table.rows.len();
    let rows = table
        .rows
        .iter()
        .enumerate()
        .map(|(index, row)| cells(row, refs, streaming && index + 1 == last))
        .collect();
    tables::table(&table.aligns, header, rows)
}

fn cells(row: &str, refs: &RefMap, streaming: bool) -> Vec<TableCell> {
    super::block::table_cells(row)
        .into_iter()
        .map(|cell| TableCell {
            spans: inline::spans(&cell, refs, streaming),
        })
        .collect()
}
