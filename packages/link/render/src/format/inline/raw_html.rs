//! HTML's shapes as CommonMark recognises them (§6.6), for inline HTML and the seventh kind of HTML
//! block. Each scanner takes text starting at `<` and returns the bytes the construct spans.

pub(crate) fn open_tag(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut at = 1 + tag_name(&bytes[1..])?;
    loop {
        let spaces = whitespace(&bytes[at..]);
        let after = at + spaces;
        match bytes.get(after) {
            Some(b'>') => return Some(after + 1),
            Some(b'/') if bytes.get(after + 1) == Some(&b'>') => return Some(after + 2),
            _ => {}
        }
        if spaces == 0 {
            return None;
        }
        at = after + attribute(&bytes[after..])?;
    }
}

pub(crate) fn close_tag(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.get(1) != Some(&b'/') {
        return None;
    }
    let at = 2 + tag_name(&bytes[2..])?;
    let at = at + whitespace(&bytes[at..]);
    (bytes.get(at) == Some(&b'>')).then_some(at + 1)
}

/// A tag name: an ASCII letter, then letters, digits and hyphens.
pub(crate) fn tag_name(bytes: &[u8]) -> Option<usize> {
    if !bytes.first()?.is_ascii_alphabetic() {
        return None;
    }
    Some(
        bytes
            .iter()
            .take_while(|byte| byte.is_ascii_alphanumeric() || **byte == b'-')
            .count(),
    )
}

/// An attribute after its leading whitespace: a name, then maybe `= value`.
fn attribute(bytes: &[u8]) -> Option<usize> {
    let first = *bytes.first()?;
    if !(first.is_ascii_alphabetic() || first == b'_' || first == b':') {
        return None;
    }
    let name = bytes
        .iter()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
        .count();
    let spaces = whitespace(&bytes[name..]);
    if bytes.get(name + spaces) != Some(&b'=') {
        return Some(name);
    }
    let value_at = name + spaces + 1;
    let value_at = value_at + whitespace(&bytes[value_at..]);
    Some(value_at + attribute_value(&bytes[value_at..])?)
}

fn attribute_value(bytes: &[u8]) -> Option<usize> {
    match *bytes.first()? {
        quote @ (b'"' | b'\'') => {
            let end = bytes[1..].iter().position(|byte| *byte == quote)?;
            Some(end + 2)
        }
        _ => {
            let length = bytes
                .iter()
                .take_while(|b| {
                    **b > b' ' && !matches!(b, b'"' | b'\'' | b'=' | b'<' | b'>' | b'`')
                })
                .count();
            (length > 0).then_some(length)
        }
    }
}

/// Spaces, tabs and up to any number of line endings.
fn whitespace(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c'))
        .count()
}
