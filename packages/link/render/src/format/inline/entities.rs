//! HTML's named character references, all 2,125 that end in `;` (CommonMark takes no others), from
//! the WHATWG's `entities.json`, one `name codepoints…` per line in `entities.txt`, sorted by name.

use std::sync::OnceLock;

const TABLE: &str = include_str!("entities.txt");

fn table() -> &'static [(&'static str, &'static str)] {
    static PARSED: OnceLock<Vec<(&str, &str)>> = OnceLock::new();
    PARSED.get_or_init(|| {
        TABLE
            .lines()
            .filter_map(|line| line.split_once(' '))
            .collect()
    })
}

/// The text `&name;` stands for.
pub(crate) fn named(name: &str) -> Option<String> {
    let table = table();
    let at = table.binary_search_by(|(known, _)| known.cmp(&name)).ok()?;
    table[at]
        .1
        .split(' ')
        .map(|hex| u32::from_str_radix(hex, 16).ok().and_then(char::from_u32))
        .collect()
}

/// A reference at the start of `text` (which starts with `&`): the text it stands for and the
/// bytes it takes. Numeric references to nothing, a surrogate or past Unicode read as U+FFFD.
pub(crate) fn reference(text: &str) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(1) == Some(&b'#') {
        let hex = matches!(bytes.get(2), Some(b'x' | b'X'));
        let digits_at = if hex { 3 } else { 2 };
        let (radix, most) = if hex { (16, 6) } else { (10, 7) };
        let digits = bytes[digits_at..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit() || (hex && byte.is_ascii_hexdigit()))
            .count();
        if digits == 0 || digits > most || bytes.get(digits_at + digits) != Some(&b';') {
            return None;
        }
        let value = u32::from_str_radix(&text[digits_at..digits_at + digits], radix).ok()?;
        let character = char::from_u32(value)
            .filter(|c| *c != '\0')
            .unwrap_or('\u{FFFD}');
        return Some((character.to_string(), digits_at + digits + 1));
    }
    let name = bytes[1..]
        .iter()
        .take_while(|byte| byte.is_ascii_alphanumeric())
        .count();
    if name == 0 || name > 32 || bytes.get(1 + name) != Some(&b';') {
        return None;
    }
    named(&text[1..1 + name]).map(|found| (found, name + 2))
}
