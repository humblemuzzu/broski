//! One pass over the lines: a blank line ends a paragraph, a fence of three or more backticks or
//! tildes opens a code block that only an equal or longer run of the same character closes.

use super::{inline, FormatBlock, FormatContent};

struct Fence {
    marker: u8,
    run: usize,
    indent: usize,
    language: Option<String>,
    lines: Vec<String>,
}

enum Open {
    Nothing,
    Paragraph { lines: Vec<String> },
    Fence(Fence),
}

pub(super) fn blocks(text: &str, streaming: bool) -> Vec<FormatBlock> {
    let mut walker = Walker {
        out: Vec::new(),
        open: Open::Nothing,
        start: 0,
    };
    let mut at = 0;
    for raw in text.split_inclusive('\n') {
        walker.line(raw.trim_end_matches(['\n', '\r']), at);
        at += raw.len();
    }
    walker.close(false, streaming);
    walker.out
}

struct Walker {
    out: Vec<FormatBlock>,
    open: Open,
    /// Where the open block's source starts.
    start: usize,
}

impl Walker {
    fn line(&mut self, line: &str, at: usize) {
        if let Open::Fence(fence) = &mut self.open {
            if closes(fence, line) {
                self.close(true, false);
            } else {
                let kept = strip_indent(line, fence.indent).to_owned();
                fence.lines.push(kept);
            }
            return;
        }
        if let Some(fence) = opens(line) {
            self.close(false, false);
            self.open = Open::Fence(fence);
            self.start = at;
        } else if line.trim().is_empty() {
            self.close(false, false);
        } else if let Open::Paragraph { lines } = &mut self.open {
            lines.push(line.trim_end().to_owned());
        } else {
            self.open = Open::Paragraph {
                lines: vec![line.trim_end().to_owned()],
            };
            self.start = at;
        }
    }

    /// Emits the open block; `fence_closed` when its closing fence was read, `streaming` when it is
    /// the text's last block and more text is coming.
    fn close(&mut self, fence_closed: bool, streaming: bool) {
        let (kind, content) = match std::mem::replace(&mut self.open, Open::Nothing) {
            Open::Nothing => return,
            Open::Paragraph { lines } => (
                "p",
                FormatContent::Paragraph {
                    spans: inline::spans(&lines.join("\n"), streaming),
                },
            ),
            Open::Fence(fence) => (
                "code",
                FormatContent::Code {
                    language: fence.language,
                    text: fence.lines.join("\n"),
                    closed: fence_closed,
                },
            ),
        };
        self.out.push(FormatBlock {
            key: format!("{kind}-{}", self.start),
            content,
        });
    }
}

/// Up to three spaces, then three or more backticks or tildes; a backtick fence's info string may
/// not hold a backtick (it would be inline code).
fn opens(line: &str) -> Option<Fence> {
    let indent = leading_spaces(line);
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let marker = *rest.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let run = rest.bytes().take_while(|byte| *byte == marker).count();
    let info = rest[run..].trim();
    if run < 3 || (marker == b'`' && info.contains('`')) {
        return None;
    }
    Some(Fence {
        marker,
        run,
        indent,
        language: info.split_whitespace().next().map(str::to_owned),
        lines: Vec::new(),
    })
}

fn closes(fence: &Fence, line: &str) -> bool {
    let indent = leading_spaces(line);
    if indent > 3 {
        return false;
    }
    let rest = &line[indent..];
    let run = rest
        .bytes()
        .take_while(|byte| *byte == fence.marker)
        .count();
    run >= fence.run && rest[run..].trim().is_empty()
}

/// A fenced line loses as many leading spaces as the opening fence was indented by, no more.
fn strip_indent(line: &str, indent: usize) -> &str {
    &line[leading_spaces(line).min(indent)..]
}

fn leading_spaces(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}
