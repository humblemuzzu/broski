//! The position in the current line, in bytes and in columns: a tab advances to the next multiple
//! of four, and a container may take only part of one (CommonMark §2.2).

use std::borrow::Cow;

pub(super) struct Cursor<'a> {
    pub line: Cow<'a, str>,
    pub offset: usize,
    pub column: usize,
    pub next_nonspace: usize,
    pub next_nonspace_column: usize,
    pub indent: usize,
    pub indented: bool,
    pub blank: bool,
    pub partially_consumed_tab: bool,
}

pub(super) const CODE_INDENT: usize = 4;

impl<'a> Cursor<'a> {
    pub fn new(line: &'a str) -> Self {
        let line = if line.contains('\0') {
            Cow::Owned(line.replace('\0', "\u{FFFD}"))
        } else {
            Cow::Borrowed(line)
        };
        Cursor {
            line,
            offset: 0,
            column: 0,
            next_nonspace: 0,
            next_nonspace_column: 0,
            indent: 0,
            indented: false,
            blank: false,
            partially_consumed_tab: false,
        }
    }

    pub fn find_next_nonspace(&mut self) {
        let bytes = self.line.as_bytes();
        let mut at = self.offset;
        let mut column = self.column;
        while let Some(&byte) = bytes.get(at) {
            match byte {
                b' ' => column += 1,
                b'\t' => column += 4 - column % 4,
                _ => break,
            }
            at += 1;
        }
        self.blank = at >= bytes.len();
        self.next_nonspace = at;
        self.next_nonspace_column = column;
        self.indent = column - self.column;
        self.indented = self.indent >= CODE_INDENT;
    }

    pub fn advance_next_nonspace(&mut self) {
        self.offset = self.next_nonspace;
        self.column = self.next_nonspace_column;
        self.partially_consumed_tab = false;
    }

    /// Moves `count` columns (`columns`) or characters forward; a tab counts as one character but
    /// may be taken a column at a time.
    pub fn advance(&mut self, mut count: usize, columns: bool) {
        while count > 0 {
            let Some(next) = self.line[self.offset..].chars().next() else {
                break;
            };
            if next == '\t' {
                let to_tab = 4 - self.column % 4;
                if columns {
                    self.partially_consumed_tab = to_tab > count;
                    let step = to_tab.min(count);
                    self.column += step;
                    if !self.partially_consumed_tab {
                        self.offset += 1;
                    }
                    count -= step;
                } else {
                    self.partially_consumed_tab = false;
                    self.column += to_tab;
                    self.offset += 1;
                    count -= 1;
                }
            } else {
                self.partially_consumed_tab = false;
                self.offset += next.len_utf8();
                self.column += 1;
                count -= 1;
            }
        }
    }

    pub fn skip_to_end(&mut self) {
        self.offset = self.line.len();
        self.partially_consumed_tab = false;
    }

    pub fn rest(&self) -> &str {
        &self.line[self.next_nonspace..]
    }

    pub fn peek_at(&self, at: usize) -> Option<u8> {
        self.line.as_bytes().get(at).copied()
    }

    /// The text from the offset on, with the columns left of a partly taken tab as spaces.
    pub fn remainder(&self) -> String {
        let rest = &self.line[self.offset..];
        if self.partially_consumed_tab {
            let spaces = 4 - self.column % 4;
            format!("{}{}", " ".repeat(spaces), &rest[1..])
        } else {
            rest.to_owned()
        }
    }
}

pub(super) fn is_space_or_tab(byte: Option<u8>) -> bool {
    matches!(byte, Some(b' ' | b'\t'))
}

/// The lines of `text` with the byte offset each starts at; `\n`, `\r\n` and `\r` all end a line.
pub(super) fn lines(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let bytes = text.as_bytes();
    let mut at = 0;
    std::iter::from_fn(move || {
        if at >= bytes.len() {
            return None;
        }
        let start = at;
        while at < bytes.len() && bytes[at] != b'\n' && bytes[at] != b'\r' {
            at += 1;
        }
        let end = at;
        if at < bytes.len() {
            at += if bytes[at] == b'\r' && bytes.get(at + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
        }
        Some((start, &text[start..end]))
    })
}
