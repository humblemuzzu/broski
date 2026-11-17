//! The pass over an inline text: each special character's handler, and runs of plain text between.

use super::chars::class;
use super::{autolink, entities, Delim, Inline, Linked, Piece};

const SPECIAL: &[u8] = b"\n\\`*_~[]!<&$";

impl Inline<'_> {
    pub(super) fn run(&mut self) {
        while self.pos < self.text.len() {
            let byte = self.text.as_bytes()[self.pos];
            let handled = match byte {
                b'\n' => self.newline(),
                b'\\' => self.backslash(),
                b'`' => self.backticks(),
                b'*' | b'_' | b'~' => self.delimiter_run(byte),
                b'[' => self.open_bracket(),
                b'!' => self.bang(),
                b']' => self.close_bracket(),
                b'<' => self.angle(),
                b'&' => self.entity(),
                b'$' => self.math(),
                b'h' | b'H' | b'w' | b'W' | b'f' | b'F' if self.at_word_start() => self.bare_url(),
                _ => false,
            };
            if !handled {
                self.text_run();
            }
        }
    }

    fn text_run(&mut self) {
        let bytes = self.text.as_bytes();
        let start = self.pos;
        let first = self.text[start..].chars().next().map_or(1, char::len_utf8);
        let mut at = start + first;
        while at < bytes.len() && !SPECIAL.contains(&bytes[at]) && !self.url_start(at) {
            at += 1;
        }
        self.push_text(&self.text[start..at]);
        self.pos = at;
    }

    fn url_start(&self, at: usize) -> bool {
        matches!(
            self.text.as_bytes()[at],
            b'h' | b'H' | b'w' | b'W' | b'f' | b'F'
        ) && boundary_before(self.text, at)
    }

    fn at_word_start(&self) -> bool {
        boundary_before(self.text, self.pos)
    }

    /// A line break: soft, or hard after two spaces; both stay a line break, trailing spaces go.
    fn newline(&mut self) -> bool {
        self.pos += 1;
        self.trim_trailing_spaces();
        self.push_text("\n");
        self.skip_spaces();
        true
    }

    pub(super) fn trim_trailing_spaces(&mut self) {
        if let Some(last) = self.items.last_mut() {
            if last.piece == Piece::Text {
                let kept = last.text.trim_end_matches(' ').len();
                last.text.truncate(kept);
            }
        }
    }

    pub(super) fn skip_spaces(&mut self) {
        let bytes = self.text.as_bytes();
        while self.pos < bytes.len() && bytes[self.pos] == b' ' {
            self.pos += 1;
        }
    }

    fn backslash(&mut self) -> bool {
        let next = self.text.as_bytes().get(self.pos + 1).copied();
        match next {
            Some(b'\n') => {
                self.pos += 2;
                self.push_text("\n");
                self.skip_spaces();
            }
            Some(b'(') if self.paren_math() => {}
            Some(byte) if byte.is_ascii_punctuation() => {
                self.push_text(&char::from(byte).to_string());
                self.pos += 2;
            }
            _ => {
                self.push_text("\\");
                self.pos += 1;
            }
        }
        true
    }

    fn backticks(&mut self) -> bool {
        let start = self.pos;
        let run = run_length(self.text, start, b'`');
        let after = start + run;
        match self.closing_run(after, run) {
            Some(close) => {
                let code = code_text(&self.text[after..close]);
                self.push(code, Piece::Code);
                self.pos = close + run;
            }
            None if self.streaming && !self.text[after..].contains('`') => {
                let code = code_text(&self.text[after..]);
                self.push(code, Piece::Code);
                self.pos = self.text.len();
            }
            None => {
                self.push_text(&self.text[start..after]);
                self.pos = after;
            }
        }
        true
    }

    /// The first run of exactly `run` backticks at or after `from`.
    fn closing_run(&mut self, from: usize, run: usize) -> Option<usize> {
        let text = self.text;
        let runs = self
            .backtick_runs
            .get_or_insert_with(|| backtick_runs(text));
        let starts = runs.get(&run)?;
        let at = starts.partition_point(|start| *start < from);
        starts.get(at).copied()
    }

    fn delimiter_run(&mut self, ch: u8) -> bool {
        let start = self.pos;
        let run = run_length(self.text, start, ch);
        let before = self.text[..start].chars().next_back();
        let after = self.text[start + run..].chars().next();
        self.pos = start + run;
        let digits =
            before.is_some_and(|c| c.is_ascii_digit()) && after.is_some_and(|c| c.is_ascii_digit());
        if (ch == b'~' && run != 2) || (ch == b'*' && run == 1 && digits) {
            self.push_text(&self.text[start..start + run]);
            return true;
        }
        let (before_space, before_punct) = class(before);
        let (after_space, after_punct) = class(after);
        let left = !after_space && (!after_punct || before_space || before_punct);
        let right = !before_space && (!before_punct || after_space || after_punct);
        let (can_open, can_close) = if ch == b'_' {
            let file_name = after == Some('.')
                && self.text[start + run + 1..].starts_with(|c: char| c.is_alphanumeric());
            (
                left && (!right || before_punct),
                right && (!left || after_punct) && !file_name,
            )
        } else {
            (left, right)
        };
        let item = self.push(self.text[start..start + run].to_owned(), Piece::Pinned);
        if can_open || can_close {
            self.push_delim(Delim {
                item,
                ch,
                count: run,
                original: run,
                can_open,
                can_close,
                at: start,
                prev: None,
                next: None,
            });
        }
        true
    }

    fn entity(&mut self) -> bool {
        let Some((found, used)) = entities::reference(&self.text[self.pos..]) else {
            return false;
        };
        self.push_text(&found);
        self.pos += used;
        true
    }

    fn bare_url(&mut self) -> bool {
        if !self.brackets.is_empty() {
            return false;
        }
        let Some(bare) = autolink::extended(&self.text[self.pos..]) else {
            return false;
        };
        let item = self.push(bare.display, Piece::Pinned);
        self.links.push(Linked {
            start: item,
            end: item + 1,
            link: bare.link,
        });
        self.pos += bare.length;
        true
    }

    fn push_delim(&mut self, mut delim: Delim) {
        let index = self.delims.len();
        delim.prev = self.top;
        if let Some(top) = self.top {
            self.delims[top].next = Some(index);
        }
        self.delims.push(delim);
        self.top = Some(index);
    }
}

pub(super) fn run_length(text: &str, at: usize, byte: u8) -> usize {
    text.as_bytes()[at..]
        .iter()
        .take_while(|found| **found == byte)
        .count()
}

/// Where a bare URL may start: at the text's start, after whitespace, or after `*`, `_`, `~`, `(`.
fn boundary_before(text: &str, at: usize) -> bool {
    at == 0
        || matches!(
            text.as_bytes()[at - 1],
            b' ' | b'\t' | b'\n' | b'*' | b'_' | b'~' | b'('
        )
}

/// A code span's text: line breaks as spaces, one space off each end when both ends have one.
fn code_text(body: &str) -> String {
    let flat = body.replace('\n', " ");
    let strip = flat.len() >= 2
        && flat.starts_with(' ')
        && flat.ends_with(' ')
        && !flat.bytes().all(|byte| byte == b' ');
    if strip {
        flat[1..flat.len() - 1].to_owned()
    } else {
        flat
    }
}

fn backtick_runs(text: &str) -> std::collections::HashMap<usize, Vec<usize>> {
    let bytes = text.as_bytes();
    let mut runs: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'`' {
            let length = run_length(text, at, b'`');
            runs.entry(length).or_default().push(at);
            at += length;
        } else {
            at += 1;
        }
    }
    runs
}
