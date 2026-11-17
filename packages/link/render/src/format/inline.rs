//! Inline code: a run of backticks opens a span that only a run of the same length closes. Its
//! line breaks read as spaces, and one space is stripped from each end when both ends have one.

use super::FormatSpan;

/// `text` as spans; with `streaming`, a code span still open at the end of the text shows as code,
/// since its closing run has not arrived yet.
pub(super) fn spans(text: &str, streaming: bool) -> Vec<FormatSpan> {
    let mut spans = Vec::new();
    let mut plain_from = 0;
    let mut at = 0;
    while let Some(offset) = text[at..].find('`') {
        let open = at + offset;
        let run = backticks(&text[open..]);
        let body_start = open + run;
        match closing(&text[body_start..], run) {
            Some(end) => {
                push(&mut spans, &text[plain_from..open], false);
                push(
                    &mut spans,
                    &code_text(&text[body_start..body_start + end]),
                    true,
                );
                at = body_start + end + run;
                plain_from = at;
            }
            None if streaming && !text[body_start..].contains('`') => {
                push(&mut spans, &text[plain_from..open], false);
                push(&mut spans, &code_text(&text[body_start..]), true);
                return spans;
            }
            None => at = body_start,
        }
    }
    push(&mut spans, &text[plain_from..], false);
    spans
}

fn backticks(text: &str) -> usize {
    text.bytes().take_while(|byte| *byte == b'`').count()
}

/// The offset of the first run of exactly `run` backticks in `text`.
fn closing(text: &str, run: usize) -> Option<usize> {
    let mut at = 0;
    while let Some(offset) = text[at..].find('`') {
        let start = at + offset;
        let found = backticks(&text[start..]);
        if found == run {
            return Some(start);
        }
        at = start + found;
    }
    None
}

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

fn push(spans: &mut Vec<FormatSpan>, text: &str, code: bool) {
    if text.is_empty() {
        return;
    }
    match spans.last_mut() {
        Some(last) if last.code == code => last.text.push_str(text),
        _ => spans.push(FormatSpan {
            text: text.to_owned(),
            code,
        }),
    }
}
