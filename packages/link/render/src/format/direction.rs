//! Which way a block reads: the direction of its first strongly directional character (the
//! Unicode bidirectional algorithm's rule P2), so an Arabic or Hebrew paragraph is laid out right
//! to left. Code, math and HTML always read left to right.

use super::model::{FormatContent, FormatSpan, TextDirection};

pub(crate) fn of(content: &FormatContent) -> TextDirection {
    let first_strong = |spans: &[FormatSpan]| {
        spans
            .iter()
            .filter(|span| !span.code && !span.math)
            .flat_map(|span| span.text.chars())
            .find_map(strong)
    };
    let found = match content {
        FormatContent::Paragraph { spans } | FormatContent::Heading { spans, .. } => {
            first_strong(spans)
        }
        FormatContent::Table { table } => table
            .header
            .iter()
            .chain(table.rows.iter().flatten())
            .find_map(|cell| first_strong(&cell.spans)),
        FormatContent::Code { .. }
        | FormatContent::Math { .. }
        | FormatContent::Html { .. }
        | FormatContent::Rule => None,
    };
    found.unwrap_or(TextDirection::LeftToRight)
}

fn strong(c: char) -> Option<TextDirection> {
    if is_right_to_left(c) {
        Some(TextDirection::RightToLeft)
    } else if c.is_alphabetic() {
        Some(TextDirection::LeftToRight)
    } else {
        None
    }
}

/// Hebrew, Arabic, Syriac, Thaana, N'Ko and the scripts after them, and their presentation forms.
fn is_right_to_left(c: char) -> bool {
    matches!(
        c as u32,
        0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF | 0x10800..=0x10FFF | 0x1E800..=0x1EFFF
    )
}
