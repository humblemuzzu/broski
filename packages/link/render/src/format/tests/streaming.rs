//! A message is parsed again on every batch while it streams. These hold the promises the apps
//! build on: every block before the last is already final (same key, same content) at every
//! character of every corpus sample, and the repairs show half-written markup as it will end up.

use crate::format::model::{FormatContent, FormatSpan};
use crate::format::{format_markdown, format_samples, FormatBlock};

fn paragraph_texts(blocks: &[FormatBlock]) -> Vec<String> {
    blocks
        .iter()
        .map(|block| match &block.content {
            FormatContent::Paragraph { spans } | FormatContent::Heading { spans, .. } => {
                spans.iter().map(|span| span.text.as_str()).collect()
            }
            FormatContent::Code { code } => code.text.clone(),
            other => format!("{other:?}"),
        })
        .collect()
}

fn last_spans(text: &str) -> Vec<FormatSpan> {
    match format_markdown(text, true).pop().map(|block| block.content) {
        Some(FormatContent::Paragraph { spans }) => spans,
        other => panic!("a paragraph at the end of {text:?}, not {other:?}"),
    }
}

#[test]
fn every_block_before_the_last_is_final_at_every_character_of_every_sample() {
    for sample in format_samples() {
        let text = &sample.text;
        let whole = format_markdown(text, false);
        for (cut, _) in text.char_indices() {
            let partial = format_markdown(&text[..cut], true);
            let settled = partial.len().saturating_sub(1);
            assert!(
                partial.len() <= whole.len() + 1,
                "{}: too many blocks at byte {cut}",
                sample.title
            );
            for index in 0..settled {
                assert_eq!(
                    partial[index], whole[index],
                    "{}: block {index} changed at byte {cut}",
                    sample.title
                );
            }
        }
    }
}

#[test]
fn open_emphasis_code_and_strike_show_styled_before_they_close() {
    let spans = last_spans("Half **bold and `half code");
    assert_eq!(spans[0].text, "Half ");
    assert!(spans[1].strong && spans[1].text == "bold and ");
    assert!(spans[2].strong && spans[2].code && spans[2].text == "half code");

    let spans = last_spans("an *open emphasis");
    assert!(spans[1].emphasis && !spans[1].text.contains('*'));
    let spans = last_spans("and ~~struck through");
    assert!(spans[1].strike && spans[1].text == "struck through");
    let spans = last_spans("snake_case_and_more");
    assert_eq!(spans.len(), 1, "an underscore inside a word opens nothing");
}

#[test]
fn half_written_markup_at_the_very_end_is_held_back() {
    let text = |source: &str| paragraph_texts(&format_markdown(source, true));
    assert_eq!(text("See [the spec](https://spec.common"), ["See the spec"]);
    assert_eq!(text("Done.\n\n##"), ["Done."], "a lone heading marker");
    assert_eq!(text("Done.\n\n- "), ["Done."], "a list marker with no text");
    assert_eq!(
        text("Done.\n\n12."),
        ["Done."],
        "an ordered marker with no text"
    );
    assert_eq!(text("Done.\n\n> "), ["Done."], "a quote marker");
    assert_eq!(
        text("Title\n==="),
        ["Title"],
        "a setext underline before its line ends"
    );
    assert_eq!(text("Hello **"), ["Hello"], "a run that styles nothing yet");
    assert_eq!(
        text("Look at [the"),
        ["Look at the"],
        "a link's bracket before its label closes"
    );
    assert_eq!(
        text("Compare:\n\n| A | B |\n|--"),
        ["Compare:"],
        "table rows before their delimiter row is whole"
    );
}

#[test]
fn an_open_fence_is_code_to_the_end_and_open_display_math_is_math_only_while_streaming() {
    let blocks = format_markdown("Run:\n\n```bash\ncargo test", true);
    match &blocks[1].content {
        FormatContent::Code { code } => {
            assert_eq!(code.text, "cargo test");
            assert!(!code.closed);
        }
        other => panic!("code, not {other:?}"),
    }
    let open_math = "So:\n\n$$\n\\sum_k k";
    assert!(matches!(
        format_markdown(open_math, true)[1].content,
        FormatContent::Math { .. }
    ));
    assert!(
        matches!(
            format_markdown(open_math, false)[1].content,
            FormatContent::Paragraph { .. }
        ),
        "a finished text never closed it: the line is text"
    );
}
