//! Character classes the delimiter rules use (CommonMark §2.1): Unicode whitespace is category Zs
//! plus tab, line feed, form feed and carriage return; Unicode punctuation is categories P and S.
//! Rust's standard library has no general categories, so punctuation is the blocks that hold P
//! and S characters, which agree with the categories for every character agents write.

pub(crate) fn is_whitespace(c: char) -> bool {
    matches!(
        c,
        ' ' | '\t' | '\n' | '\x0c' | '\r' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

pub(crate) fn is_punctuation(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_punctuation();
    }
    let code = c as u32;
    matches!(
        code,
        0xA1..=0xA9
            | 0xAB | 0xAC | 0xAE..=0xB1
            | 0xB4 | 0xB6..=0xB8
            | 0xBB | 0xBF | 0xD7 | 0xF7
            | 0x2C2..=0x2C5
            | 0x2D2..=0x2DF
            | 0x2E5..=0x2EB
            | 0x2ED | 0x2EF..=0x2FF
            | 0x375 | 0x37E | 0x384 | 0x385 | 0x387
            | 0x55A..=0x55F
            | 0x589 | 0x58A | 0x5BE | 0x5C0 | 0x5C3 | 0x5C6 | 0x5F3 | 0x5F4
            | 0x609..=0x60D
            | 0x61B | 0x61D..=0x61F
            | 0x66A..=0x66D
            | 0x6D4 | 0x964 | 0x965 | 0x970 | 0xE4F | 0xE5A | 0xE5B
            | 0x2010..=0x2027
            | 0x2030..=0x205E
            | 0x207A..=0x207E
            | 0x208A..=0x208E
            | 0x20A0..=0x20C0
            | 0x2190..=0x23FF
            | 0x2400..=0x244A
            | 0x2500..=0x2775
            | 0x2794..=0x2BFF
            | 0x2E00..=0x2E7F
            | 0x3001..=0x3003
            | 0x3008..=0x3020
            | 0x3030 | 0x303D..=0x303F
            | 0x30A0 | 0x30FB
            | 0xFE10..=0xFE19
            | 0xFE30..=0xFE6B
            | 0xFF01..=0xFF0F
            | 0xFF1A..=0xFF20
            | 0xFF3B..=0xFF40
            | 0xFF5B..=0xFF65
            | 0xFFE0..=0xFFEE
            | 0x1F000..=0x1FAFF
    )
}

/// What a delimiter run sees on one side: the edge of the text reads as whitespace.
pub(crate) fn class(c: Option<char>) -> (bool, bool) {
    match c {
        None => (true, false),
        Some(c) => (is_whitespace(c), is_punctuation(c)),
    }
}
