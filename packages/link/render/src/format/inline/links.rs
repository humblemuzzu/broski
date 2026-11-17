//! The parts of a link (CommonMark §6.3): its label, destination and title, shared by inline links
//! and link reference definitions.

use super::unescape;

const MAX_LABEL_CHARS: usize = 999;
/// Nested parentheses a bare destination may hold, as cmark allows.
const MAX_PARENS: usize = 32;

/// A label at the start of `text` (`[` … `]`): the bytes it takes, brackets included. No unescaped
/// bracket inside, at most 999 characters.
pub(crate) fn link_label(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'[') {
        return None;
    }
    let mut at = 1;
    let mut chars = 0;
    while at < bytes.len() {
        match bytes[at] {
            b']' => return (chars <= MAX_LABEL_CHARS).then_some(at + 1),
            b'[' => return None,
            b'\\' if at + 1 < bytes.len() && bytes[at + 1].is_ascii_punctuation() => at += 1,
            _ => {}
        }
        at += 1;
        if text.is_char_boundary(at) {
            chars += 1;
        }
        if chars > MAX_LABEL_CHARS {
            return None;
        }
    }
    None
}

/// A destination at the start of `text`: `<…>` or a run with balanced parentheses and no spaces
/// or controls. The destination with its escapes and references resolved, and the bytes it takes.
pub(crate) fn link_destination(text: &str) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    if bytes.first() == Some(&b'<') {
        let mut at = 1;
        while at < bytes.len() {
            match bytes[at] {
                b'>' => return Some((unescape(&text[1..at]), at + 1)),
                b'<' | b'\n' | b'\r' => return None,
                b'\\' if at + 1 < bytes.len() && bytes[at + 1].is_ascii_punctuation() => at += 1,
                _ => {}
            }
            at += 1;
        }
        return None;
    }
    let mut at = 0;
    let mut parens = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' if at + 1 < bytes.len() && bytes[at + 1].is_ascii_punctuation() => at += 1,
            b'(' => {
                parens += 1;
                if parens > MAX_PARENS {
                    return None;
                }
            }
            b')' if parens == 0 => break,
            b')' => parens -= 1,
            byte if byte <= b' ' || byte == 0x7f => break,
            _ => {}
        }
        at += 1;
    }
    if (at == 0 && bytes.first() != Some(&b')')) || parens != 0 {
        return None;
    }
    Some((unescape(&text[..at]), at))
}

/// A title at the start of `text`: `"…"`, `'…'` or `(…)`. The title resolved, and the bytes taken.
pub(crate) fn link_title(text: &str) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    let close = match bytes.first()? {
        b'"' => b'"',
        b'\'' => b'\'',
        b'(' => b')',
        _ => return None,
    };
    let mut at = 1;
    while at < bytes.len() {
        match bytes[at] {
            byte if byte == close => return Some((unescape(&text[1..at]), at + 1)),
            b'(' if close == b')' => return None,
            b'\\' if at + 1 < bytes.len() => at += 1,
            _ => {}
        }
        at += 1;
    }
    None
}

/// Spaces and tabs with at most one line break among them: the bytes they take.
pub(crate) fn spaces_and_newline(text: &str) -> usize {
    let bytes = text.as_bytes();
    let mut at = 0;
    let mut newline = false;
    while at < bytes.len() {
        match bytes[at] {
            b' ' | b'\t' => {}
            b'\n' if !newline => newline = true,
            _ => break,
        }
        at += 1;
    }
    at
}

/// Labels match case-insensitively with runs of whitespace as one space (§4.7): Unicode case
/// folding, which lower- then upper-casing approximates as cmark does (`ẞ` matches `SS`).
pub(crate) fn normalize_label(label: &str) -> String {
    let collapsed = label.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.to_lowercase().to_uppercase()
}
