//! The block side of the streaming repair: a last line that is only block markers so far (`#`,
//! `-`, `1.`, `>`, a setext underline, the start of a fence or display math) is held back until
//! its text or line break arrives, so a line never flashes into a heading, a list or a rule.

pub(crate) fn hold_back(text: &str) -> &str {
    let start = text.rfind('\n').map_or(0, |at| at + 1);
    let last = &text[start..];
    if !last.trim().is_empty() && last.split_whitespace().all(is_marker) {
        &text[..start]
    } else {
        text
    }
}

fn is_marker(part: &str) -> bool {
    let all = |byte: u8| !part.is_empty() && part.bytes().all(|found| found == byte);
    let ordered = part.strip_suffix(['.', ')']).is_some_and(|digits| {
        !digits.is_empty() && digits.len() <= 9 && digits.bytes().all(|b| b.is_ascii_digit())
    });
    let alert = part
        .strip_prefix("[!")
        .is_some_and(|name| name.bytes().all(|b| b.is_ascii_alphabetic() || b == b']'));
    ordered
        || alert
        || b">#-*+=_`~$|".iter().copied().any(all)
        || matches!(part, "[" | "]" | "[x" | "[X" | "[x]" | "[X]")
        || part.starts_with("```")
        || part.starts_with("~~~")
}
