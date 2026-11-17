//! Inline TeX: `$…$` by pandoc's rules, `$$…$$`, and `\(…\)`.

use super::{Inline, Piece};

impl Inline<'_> {
    /// `\( … \)` around something that is not just spaces.
    pub(super) fn paren_math(&mut self) -> bool {
        let Some(end) = self.find_ahead("\\)", self.pos + 2) else {
            return false;
        };
        let tex = self.text[self.pos + 2..end].trim();
        if tex.is_empty() {
            return false;
        }
        self.push(tex.to_owned(), Piece::Math);
        self.pos = end + 2;
        true
    }

    /// `$…$` by pandoc's rules, so prices are never math: the opening `$` has a non-space after
    /// it, the closing one a non-space before it and no digit after it. `$$…$$` inline is math too.
    pub(super) fn math(&mut self) -> bool {
        let start = self.pos;
        if self.text[start..].starts_with("$$") {
            let Some(end) = self.find_ahead("$$", start + 2) else {
                return false;
            };
            let tex = self.text[start + 2..end].trim();
            if tex.is_empty() {
                return false;
            }
            self.push(tex.to_owned(), Piece::Math);
            self.pos = end + 2;
            return true;
        }
        let opens = self.text[start + 1..]
            .chars()
            .next()
            .is_some_and(|c| !c.is_whitespace() && c != '$');
        if !opens {
            return false;
        }
        let text = self.text;
        let closers = self
            .dollar_closers
            .get_or_insert_with(|| dollar_closers(text));
        let at = closers.partition_point(|closer| *closer <= start + 1);
        let Some(&end) = closers.get(at) else {
            return false;
        };
        self.push(self.text[start + 1..end].to_owned(), Piece::Math);
        self.pos = end + 1;
        true
    }
}

/// Every `$` that can close inline math: a non-space before it, no backslash escaping it, no
/// digit after it.
fn dollar_closers(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    (1..bytes.len())
        .filter(|at| bytes[*at] == b'$')
        .filter(|at| !matches!(bytes[at - 1], b' ' | b'\t' | b'\n' | b'\\' | b'$'))
        .filter(|at| !bytes.get(at + 1).is_some_and(u8::is_ascii_digit))
        .collect()
}
