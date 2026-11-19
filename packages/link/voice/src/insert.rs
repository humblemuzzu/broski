//! Inserts a spoken transcript into a composer draft at a UTF-16 cursor offset (or at the end),
//! adding spaces only where the surrounding characters and language want them.

/// The draft after inserting a dictation transcript, plus the new UTF-16 cursor offset right after
/// the inserted text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictationInsert {
    pub text: String,
    pub cursor_utf16: u32,
}

/// Languages written without spaces between words.
const NO_SPACE_LANGUAGES: &[&str] = &["ja", "zh", "yue", "th", "lo", "km", "my"];

/// Inserts `transcript` into `draft` at `cursor_utf16` (or the end when `None`), returning the
/// joined text and the new UTF-16 cursor position.
pub fn insert_dictation(
    draft: &str,
    cursor_utf16: Option<u32>,
    transcript: &str,
    language: Option<&str>,
) -> DictationInsert {
    let spoken = transcript.trim();
    let end_u16 = draft.encode_utf16().count() as u32;
    let clamped_u16 = cursor_utf16.map_or(end_u16, |c| c.min(end_u16));
    if spoken.is_empty() {
        return DictationInsert {
            text: draft.to_owned(),
            cursor_utf16: clamped_u16,
        };
    }

    let split_byte = utf16_to_byte(draft, clamped_u16 as usize);
    let before = &draft[..split_byte];
    let after = &draft[split_byte..];
    let no_space_lang = language.is_some_and(is_no_space_language);

    let first_spoken = spoken.chars().next();
    let last_spoken = spoken.chars().last();

    let need_leading_space = !before.is_empty()
        && !no_space_lang
        && before.chars().last().is_some_and(|ch| {
            !ch.is_whitespace()
                && !is_opening_bracket(ch)
                && !is_cjk_or_sea(ch)
                && first_spoken.is_some_and(|s| !is_cjk_or_sea(s))
        });

    let need_trailing_space = !after.is_empty()
        && !no_space_lang
        && after.chars().next().is_some_and(|ch| {
            !ch.is_whitespace()
                && !is_closing_or_punct(ch)
                && !is_cjk_or_sea(ch)
                && last_spoken.is_some_and(|s| !is_cjk_or_sea(s))
        });

    let mut out = String::with_capacity(draft.len() + spoken.len() + 2);
    out.push_str(before);
    if need_leading_space {
        out.push(' ');
    }
    out.push_str(spoken);
    let new_cursor = out.encode_utf16().count() as u32;
    if need_trailing_space {
        out.push(' ');
    }
    out.push_str(after);

    DictationInsert {
        text: out,
        cursor_utf16: new_cursor,
    }
}

fn is_no_space_language(code: &str) -> bool {
    let primary = code
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    NO_SPACE_LANGUAGES.contains(&primary.as_str())
}

fn is_opening_bracket(ch: char) -> bool {
    matches!(
        ch,
        '(' | '[' | '{' | '"' | '\'' | '`' | '“' | '‘' | '「' | '『' | '（'
    )
}

fn is_closing_or_punct(ch: char) -> bool {
    matches!(
        ch,
        ')' | ']' | '}' | '.' | ',' | ';' | ':' | '!' | '?' | '”' | '’' | '」' | '』' | '）'
    )
}

fn is_cjk_or_sea(ch: char) -> bool {
    let cp = ch as u32;
    matches!(
        cp,
        0x0E00..=0x0E7F   // Thai
        | 0x0E80..=0x0EFF // Lao
        | 0x1000..=0x109F // Myanmar
        | 0x1780..=0x17FF // Khmer
        | 0x3000..=0x30FF // CJK punctuation, Hiragana, Katakana
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
        | 0xFF00..=0xFFEF // Fullwidth forms
    )
}

/// Converts a UTF-16 code-unit offset to the nearest valid UTF-8 byte offset without ever
/// splitting a surrogate pair.
fn utf16_to_byte(text: &str, target_utf16: usize) -> usize {
    let mut u16_pos = 0;
    for (byte_pos, ch) in text.char_indices() {
        if u16_pos >= target_utf16 {
            return byte_pos;
        }
        let next = u16_pos + ch.len_utf16();
        if next > target_utf16 {
            // Target landed in the middle of a surrogate pair: snap past it so emoji stay intact.
            return byte_pos + ch.len_utf8();
        }
        u16_pos = next;
    }
    text.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_with_single_space_when_joining_english_words() {
        let res = insert_dictation("fix the", None, "login bug", Some("en"));
        assert_eq!(res.text, "fix the login bug");
        assert_eq!(res.cursor_utf16, res.text.encode_utf16().count() as u32);

        let res = insert_dictation("fix the ", None, "login bug", Some("en"));
        assert_eq!(res.text, "fix the login bug");

        let res = insert_dictation("", None, "  hello  ", Some("en"));
        assert_eq!(res.text, "hello");
    }

    #[test]
    fn inserts_at_cursor_and_preserves_emoji_surrogate_pairs() {
        let res = insert_dictation("hello world", Some(5), "dear", Some("en"));
        assert_eq!(res.text, "hello dear world");
        assert_eq!(res.cursor_utf16, 10);

        // "🚀" is 2 UTF-16 units; cursor at 1 snaps safely past it instead of splitting it.
        let res = insert_dictation("🚀go", Some(1), "now", Some("en"));
        assert_eq!(res.text, "🚀 now go");
        assert_eq!(res.cursor_utf16, 6);
    }

    #[test]
    fn omits_spaces_for_cjk_and_southeast_asian_languages() {
        let res = insert_dictation("今日は", None, "いい天気", Some("ja-JP"));
        assert_eq!(res.text, "今日はいい天気");
        let res = insert_dictation("你好", None, "世界", None);
        assert_eq!(res.text, "你好世界");
    }

    #[test]
    fn respects_brackets_and_trailing_punctuation() {
        let res = insert_dictation("check (). ", Some(7), "foo", Some("en"));
        assert_eq!(res.text, "check (foo). ");
        assert_eq!(res.cursor_utf16, 10);
    }
}
