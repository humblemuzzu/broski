//! Repairs to a streaming text's open end, after Vercel's `remend` and OpenCode's `patchmark`:
//! markup that has only begun is held back rather than shown as its characters. The rest of the
//! repair is in the pass itself (an open code span, a half-written link destination, open
//! emphasis), which knows what is open.

use super::Inline;

/// The text without what dangles at its very end: a run of `*`, `_` or `~` with nothing after it
/// that it could style, an opening bracket, a lone `<` or backslash.
pub(super) fn trim_dangling(text: &str) -> &str {
    let mut text = text;
    loop {
        let trimmed = trim_once(text);
        if trimmed.len() == text.len() {
            return text;
        }
        text = trimmed;
    }
}

fn trim_once(text: &str) -> &str {
    if let Some(rest) = text.strip_suffix("![") {
        return rest;
    }
    if let Some(rest) = text.strip_suffix(['[', '<', '\\']) {
        return rest;
    }
    let Some(last) = text.bytes().last() else {
        return text;
    };
    if !matches!(last, b'*' | b'_' | b'~') {
        return text;
    }
    let run = text.bytes().rev().take_while(|byte| *byte == last).count();
    let before = &text[..text.len() - run];
    let opens_nothing = before.is_empty() || before.ends_with([' ', '\t', '\n']);
    if opens_nothing {
        before.trim_end_matches([' ', '\t'])
    } else {
        text
    }
}

impl Inline<'_> {
    /// While streaming, a `[` on the last line with no `]` after it is a link still being written:
    /// its bracket is held back.
    pub(super) fn hide_open_brackets(&mut self) {
        if !self.streaming {
            return;
        }
        let brackets = std::mem::take(&mut self.brackets);
        let last_close = self.text.rfind(']');
        for bracket in brackets {
            let on_last_line = bracket.inside >= self.last_line;
            let closed_later = last_close.is_some_and(|at| at >= bracket.inside);
            if on_last_line && !closed_later {
                self.items[bracket.item].text.clear();
            }
        }
    }
}
