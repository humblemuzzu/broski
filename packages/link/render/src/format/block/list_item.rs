//! List items (CommonMark §5.2): the marker, and how far the item's text is indented, which every
//! later line of the item must match.

use super::cursor::{is_space_or_tab, Cursor, CODE_INDENT};
use super::tree::{Kind, ListData};
use super::{Parser, Started};

pub(super) fn list_item(parser: &mut Parser, cursor: &mut Cursor, container: usize) -> Started {
    let kind = &parser.nodes[container].kind;
    let in_list = matches!(kind, Kind::List(_));
    let in_paragraph = matches!(kind, Kind::Paragraph);
    if (cursor.indented && !in_list) || cursor.indent >= CODE_INDENT {
        return Started::No;
    }
    let Some((bullet, start, delimiter, length)) = list_marker(cursor.rest(), in_paragraph) else {
        return Started::No;
    };
    let marker = parser.line_start + cursor.next_nonspace;
    let marker_offset = cursor.indent;
    cursor.advance_next_nonspace();
    cursor.advance(length, true);
    let padding = length + spaces_after_marker(cursor);
    parser.close_unmatched();
    let data = ListData {
        bullet,
        start,
        delimiter,
        marker_offset,
        padding,
    };
    let continues =
        matches!(&parser.nodes[parser.tip].kind, Kind::List(list) if list.same_list(&data));
    if !continues {
        parser.add_child(Kind::List(data), marker);
    }
    parser.add_child(Kind::Item(data), marker);
    Started::Container
}

/// A bullet or an ordered marker followed by a space, a tab or the line's end. Interrupting a
/// paragraph, a list must start at 1 and its first line must hold text.
fn list_marker(rest: &str, in_paragraph: bool) -> Option<(Option<u8>, u64, u8, usize)> {
    let bytes = rest.as_bytes();
    let first = *bytes.first()?;
    let (bullet, start, delimiter, length) = if matches!(first, b'-' | b'+' | b'*') {
        (Some(first), 1, 0, 1)
    } else {
        let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
        let delimiter = *bytes.get(digits)?;
        if digits == 0 || digits > 9 || !matches!(delimiter, b'.' | b')') {
            return None;
        }
        let start = rest[..digits].parse().ok()?;
        if in_paragraph && start != 1 {
            return None;
        }
        (None, start, delimiter, digits + 1)
    };
    if !matches!(bytes.get(length), None | Some(b' ' | b'\t')) {
        return None;
    }
    if in_paragraph && rest[length..].trim_matches([' ', '\t']).is_empty() {
        return None;
    }
    Some((bullet, start, delimiter, length))
}

/// The columns between a list marker and its text: one when there are five or more (the text is
/// then indented code) or none at all.
fn spaces_after_marker(cursor: &mut Cursor) -> usize {
    let start_column = cursor.column;
    let start_offset = cursor.offset;
    loop {
        cursor.advance(1, true);
        let next = cursor.peek_at(cursor.offset);
        if cursor.column - start_column >= 5 || !is_space_or_tab(next) {
            break;
        }
    }
    let blank_item = cursor.peek_at(cursor.offset).is_none();
    let spaces = cursor.column - start_column;
    if !(1..5).contains(&spaces) || blank_item {
        cursor.column = start_column;
        cursor.offset = start_offset;
        cursor.partially_consumed_tab = false;
        if is_space_or_tab(cursor.peek_at(cursor.offset)) {
            cursor.advance(1, true);
        }
        1
    } else {
        spaces
    }
}
