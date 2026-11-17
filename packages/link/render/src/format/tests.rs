use super::*;

fn plain(text: &str) -> FormatSpan {
    FormatSpan {
        text: text.to_owned(),
        code: false,
    }
}

fn code(text: &str) -> FormatSpan {
    FormatSpan {
        text: text.to_owned(),
        code: true,
    }
}

fn paragraph(spans: Vec<FormatSpan>) -> FormatContent {
    FormatContent::Paragraph { spans }
}

fn contents(text: &str, streaming: bool) -> Vec<FormatContent> {
    format_markdown(text, streaming)
        .into_iter()
        .map(|block| block.content)
        .collect()
}

#[test]
fn an_answer_is_paragraphs_and_a_fenced_block_keyed_by_where_each_starts() {
    let text =
        "Run `bun test` first.\nThen this:\n\n```ts\nconst a = 1;\n\nexport { a };\n```\n\nDone.";
    let blocks = format_markdown(text, false);
    assert_eq!(
        blocks
            .iter()
            .map(|block| block.key.as_str())
            .collect::<Vec<_>>(),
        ["p-0", "code-34", "p-73"]
    );
    assert_eq!(
        blocks[0].content,
        paragraph(vec![
            plain("Run "),
            code("bun test"),
            plain(" first.\nThen this:")
        ])
    );
    assert_eq!(
        blocks[1].content,
        FormatContent::Code {
            language: Some("ts".to_owned()),
            text: "const a = 1;\n\nexport { a };".to_owned(),
            closed: true,
        }
    );
}

#[test]
fn a_fence_closes_only_by_an_equal_or_longer_run_of_its_own_character() {
    let text = "````md\n```json\n{}\n```\n~~~\n`````\nafter";
    assert_eq!(
        contents(text, false),
        [
            FormatContent::Code {
                language: Some("md".to_owned()),
                text: "```json\n{}\n```\n~~~".to_owned(),
                closed: true,
            },
            paragraph(vec![plain("after")]),
        ]
    );
    assert_eq!(
        contents("``` a`b\nnot a fence", false),
        [paragraph(vec![plain("``` a`b\nnot a fence")])],
        "a backtick fence's info may not hold a backtick"
    );
    assert_eq!(
        contents("    ```\nindented four", false),
        [paragraph(vec![plain("    ```\nindented four")])]
    );
}

#[test]
fn an_unclosed_fence_is_code_to_the_end_and_says_so() {
    assert_eq!(
        contents("Here:\n\n  ```rust\n  fn main() {\n      go();", true),
        [
            paragraph(vec![plain("Here:")]),
            FormatContent::Code {
                language: Some("rust".to_owned()),
                text: "fn main() {\n    go();".to_owned(),
                closed: false,
            },
        ]
    );
}

#[test]
fn inline_code_matches_runs_of_one_length_and_reads_line_breaks_as_spaces() {
    assert_eq!(
        contents("a ``x ` y`` b `` ` `` c `one\ntwo`", false),
        [paragraph(vec![
            plain("a "),
            code("x ` y"),
            plain(" b "),
            code("`"),
            plain(" c "),
            code("one two"),
        ])]
    );
    assert_eq!(
        contents("a lone ` stays, and `` this too", false),
        [paragraph(vec![plain("a lone ` stays, and `` this too")])]
    );
}

#[test]
fn while_streaming_the_last_open_code_span_shows_as_code() {
    let text = "Edit `src/main.rs and";
    assert_eq!(
        contents(text, true),
        [paragraph(vec![plain("Edit "), code("src/main.rs and")])]
    );
    assert_eq!(
        contents(text, false),
        [paragraph(vec![plain(text)])],
        "a finished text shows its stray backtick as written"
    );
    assert_eq!(
        contents("one\n\n`two", true)[0],
        paragraph(vec![plain("one")]),
        "only the last block is still being written"
    );
}

#[test]
fn a_message_streamed_one_character_at_a_time_redraws_only_its_last_block() {
    let text = include_str!("../../tests/fixtures/format/01-agent-answer.md");
    let whole = format_markdown(text, false);
    for (cut, _) in text.char_indices() {
        let partial = format_markdown(&text[..cut], true);
        let settled = partial.len().saturating_sub(1);
        assert_eq!(
            partial[..settled],
            whole[..settled],
            "every block before the last is final at byte {cut}"
        );
    }
}

#[test]
fn text_past_the_bound_is_one_plain_paragraph() {
    let text = format!("{}\n\ntail `x`", "a".repeat(MAX_FORMAT_BYTES));
    let blocks = format_markdown(&text, true);
    let last = blocks.last().expect("a last block");
    assert_eq!(last.key, format!("rest-{MAX_FORMAT_BYTES}"));
    assert_eq!(last.content, paragraph(vec![plain("\n\ntail `x`")]));
}

#[test]
fn every_gallery_sample_formats() {
    let samples = format_samples();
    assert_eq!(samples.len(), 12);
    for sample in samples {
        assert!(!sample.title.is_empty());
        assert!(
            !format_markdown(&sample.text, false).is_empty(),
            "{}",
            sample.title
        );
    }
}
