//! A session list's `search`, as the bridge reads it (`searchWords` and `sessionMatches` in the contract's
//! `sessions.ts`): rows the catalog sends a search list are kept or left by the same words.

/// JavaScript's `\s`, which the bridge splits a search on; Rust's `char::is_whitespace` differs at U+0085 and U+FEFF.
fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// The words of a search, lowercased; none for a search of only spaces.
pub(crate) fn search_words(search: &str) -> Vec<String> {
    search
        .to_lowercase()
        .split(is_space)
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Whether every word appears in the title or the working directory's name (its last component),
/// ignoring case.
pub(crate) fn session_matches(words: &[String], title: Option<&str>, cwd: Option<&str>) -> bool {
    if words.is_empty() {
        return true;
    }
    let folder = cwd
        .and_then(|cwd| cwd.split('/').rfind(|part| !part.is_empty()))
        .unwrap_or("");
    let haystack = format!("{}\n{folder}", title.unwrap_or("")).to_lowercase();
    words.iter().all(|word| haystack.contains(word.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_word_must_appear_in_the_title_or_the_folder_ignoring_case() {
        let words = search_words("  Inbox\u{3000}BROSKI\t");
        assert_eq!(words, ["inbox", "broski"]);
        assert!(session_matches(
            &words,
            Some("Fix the inbox"),
            Some("/Users/me/broski/")
        ));
        assert!(!session_matches(
            &words,
            Some("Fix the inbox"),
            Some("/Users/me/other")
        ));
        assert!(!session_matches(&words, None, Some("/Users/me/broski")));
        let users = search_words("users");
        assert!(
            !session_matches(&users, Some("A title"), Some("/Users/me/broski")),
            "only the folder's name"
        );
        assert!(
            session_matches(&search_words(" \u{FEFF} "), None, None),
            "no words keep everything"
        );
        assert_eq!(
            search_words("a\u{85}b"),
            ["a\u{85}b"],
            "U+0085 is no space to JavaScript"
        );
    }
}
