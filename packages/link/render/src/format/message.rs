//! The person's own message, and a notice: text written by hand, so only inline styles and fenced
//! code are read; a `#`, `-` or `>` at a line's start stays exactly as typed.

use super::block::RefMap;
use super::inline;
use super::model::{FormatBlock, FormatCode, FormatContent, FormatSpacing, TextDirection};

/// `text` as paragraphs and fenced code blocks, keyed like `format_markdown`'s.
pub fn format_message(text: &str) -> Vec<FormatBlock> {
    let text = crate::prefix(text, super::MAX_FORMAT_BYTES);
    let refs = RefMap::default();
    let mut blocks = Vec::new();
    let mut paragraph_start = 0;
    let mut at = 0;
    while at < text.len() {
        let line_end = text[at..].find('\n').map_or(text.len(), |end| at + end);
        if let Some((marker, run)) = fence(&text[at..line_end]) {
            push_paragraph(&mut blocks, text, paragraph_start, at, &refs);
            let (code, end) = fenced(text, at, line_end, marker, run);
            push(
                &mut blocks,
                format!("code-{at}"),
                FormatContent::Code { code },
            );
            at = end;
            paragraph_start = end;
            continue;
        }
        at = line_end + 1;
    }
    push_paragraph(&mut blocks, text, paragraph_start, text.len(), &refs);
    blocks
}

/// A fence line: up to three spaces, then three or more backticks or tildes.
fn fence(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let run = trimmed.chars().take_while(|c| *c == marker).count();
    (run >= 3 && !(marker == '`' && trimmed[run..].contains('`'))).then_some((marker, run))
}

/// The code from the fence at `start` to its closing fence or the text's end, and where the text
/// after it starts.
fn fenced(
    text: &str,
    start: usize,
    line_end: usize,
    marker: char,
    run: usize,
) -> (FormatCode, usize) {
    let info = text[start..line_end]
        .trim()
        .trim_start_matches(marker)
        .trim();
    let mut lines = Vec::new();
    let mut at = line_end + 1;
    let mut closed = false;
    while at < text.len() {
        let end = text[at..].find('\n').map_or(text.len(), |found| at + found);
        let line = &text[at..end];
        at = end + 1;
        if fence(line).is_some_and(|(found, length)| {
            found == marker && length >= run && line.trim().chars().all(|c| c == marker)
        }) {
            closed = true;
            break;
        }
        lines.push(line);
    }
    let language = info.split_whitespace().next().map(str::to_owned);
    let code = FormatCode {
        prose: language.is_none(),
        language,
        file: None,
        text: lines.join("\n"),
        closed,
    };
    (code, at.min(text.len()))
}

fn push_paragraph(
    blocks: &mut Vec<FormatBlock>,
    text: &str,
    start: usize,
    end: usize,
    refs: &RefMap,
) {
    let source = &text[start..end.max(start)];
    if source.trim().is_empty() {
        return;
    }
    let leading = source.len() - source.trim_start_matches(['\n', ' ', '\t']).len();
    let spans = inline::spans(source, refs, false);
    push(
        blocks,
        format!("p-{}", start + leading),
        FormatContent::Paragraph { spans },
    );
}

fn push(blocks: &mut Vec<FormatBlock>, key: String, content: FormatContent) {
    let spacing = if blocks.is_empty() {
        FormatSpacing::None
    } else {
        FormatSpacing::Paragraph
    };
    blocks.push(FormatBlock {
        key,
        containers: Vec::new(),
        spacing,
        direction: TextDirection::LeftToRight,
        content,
    });
    if let Some(block) = blocks.last_mut() {
        block.direction = super::direction::of(&block.content);
    }
}
