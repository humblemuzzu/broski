//! What Broski adds to CommonMark and GitHub, and how agents' real text reads: links and paths,
//! math and tildes, callouts and the insight block, list markers, spacing, direction, tables, code
//! fences, inline HTML and the size bound.

use crate::format::model::*;
use crate::format::{format_markdown, format_samples, FormatSample, MAX_FORMAT_BYTES};

fn spans(text: &str) -> Vec<FormatSpan> {
    match format_markdown(text, false).remove(0).content {
        FormatContent::Paragraph { spans } => spans,
        other => panic!("a paragraph, not {other:?}"),
    }
}

fn table(text: &str) -> FormatTable {
    format_markdown(text, false)
        .into_iter()
        .find_map(|block| match block.content {
            FormatContent::Table { table } => Some(table),
            _ => None,
        })
        .expect("a table")
}

#[test]
fn alerts_and_the_insight_block_are_callouts_whose_first_block_carries_the_title() {
    let alerts = format_markdown(
        "> [!WARNING]\n> This deletes the worktree.\n>\n> Twice.",
        false,
    );
    let kinds: Vec<(ContainerKind, bool)> = alerts
        .iter()
        .map(|block| (block.containers[0].kind.clone(), block.containers[0].first))
        .collect();
    let warning = ContainerKind::Callout {
        kind: CalloutKind::Warning,
    };
    assert_eq!(kinds, [(warning.clone(), true), (warning, false)]);
    let bold = format_markdown("> **Note**\n> Needs `test-util`.", false);
    assert_eq!(
        bold[0].containers[0].kind,
        ContainerKind::Callout {
            kind: CalloutKind::Note
        },
        "the older bold form"
    );
    let insight = format_markdown(
        "`★ Insight ─────────`\n- one\n- two\n`─────────`\n\nAfter.",
        false,
    );
    assert_eq!(insight.len(), 3);
    for block in &insight[..2] {
        assert_eq!(
            block.containers[0].kind,
            ContainerKind::Callout {
                kind: CalloutKind::Insight
            }
        );
    }
    assert!(
        insight[2].containers.is_empty(),
        "the closing rule ends the callout"
    );
}

#[test]
fn list_markers_number_from_the_start_and_the_gutter_fits_the_widest() {
    let blocks = format_markdown(
        "7. a\n8. b\n9. c\n10. d\n\n- [x] done\n- [ ] todo\n  - nested",
        false,
    );
    let markers: Vec<(ListMarker, u32, u32)> = blocks
        .iter()
        .map(
            |block| match &block.containers.last().map(|c| c.kind.clone()) {
                Some(ContainerKind::Item {
                    marker,
                    depth,
                    width,
                    ..
                }) => (marker.clone(), *depth, *width),
                other => panic!("an item, not {other:?}"),
            },
        )
        .collect();
    let number = |value| ListMarker::Number {
        value,
        paren: false,
    };
    assert_eq!(
        markers,
        [
            (number(7), 0, 3),
            (number(8), 0, 3),
            (number(9), 0, 3),
            (number(10), 0, 3),
            (ListMarker::Task { checked: true }, 0, 1),
            (ListMarker::Task { checked: false }, 0, 1),
            (ListMarker::Bullet, 1, 1),
        ]
    );
    let hundred: String = (1..=100).map(|n| format!("{n}. item\n")).collect();
    assert!(format_markdown(&hundred, false)
        .iter()
        .all(|block| matches!(
            block.containers[0].kind,
            ContainerKind::Item { width: 4, .. }
        )));
}

#[test]
fn groups_of_a_tight_list_and_the_blocks_after_code_tables_and_rules_get_room() {
    let text = "- **Tables:**\n  - wrap\n  - scroll\n- **Code:**\n  - fold\n- plain\n- items\n\n```sh\nls\n```\nAfter code.\n\n---\n\nAfter a rule.";
    let steps: Vec<FormatSpacing> = format_markdown(text, false)
        .iter()
        .map(|block| block.spacing)
        .collect();
    use FormatSpacing::*;
    assert_eq!(
        steps,
        [
            None, Tight, Tight, AfterGroup, Tight, AfterGroup, Tight, Paragraph, Section,
            Paragraph, Section
        ]
    );
}

#[test]
fn the_point_after_a_long_one_is_set_apart_and_short_points_stay_together() {
    let long = "**Reciprocity of liking.** We like people who like us; someone who moves from cool to warm is liked more.";
    let text = format!("- {long}\n- short\n- also short\n- {long}\n- last");
    let steps: Vec<FormatSpacing> = format_markdown(&text, false)
        .iter()
        .map(|block| block.spacing)
        .collect();
    use FormatSpacing::*;
    assert_eq!(steps, [None, AfterGroup, Tight, Tight, AfterGroup]);
}

#[test]
fn spacing_steps_follow_what_each_block_comes_after() {
    let text =
        "Intro.\n\n## Heading\n\nUnder it.\n\n- tight\n- items\n\n- then\n\n  loose\n\nLast.";
    let steps: Vec<FormatSpacing> = format_markdown(text, false)
        .iter()
        .map(|block| block.spacing)
        .collect();
    use FormatSpacing::*;
    assert_eq!(
        steps,
        [
            None,
            Section,
            AfterHeading,
            Paragraph,
            Tight,
            Loose,
            Paragraph,
            Paragraph
        ]
    );
}

#[test]
fn right_to_left_paragraphs_read_right_to_left_and_code_never_does() {
    let blocks = format_markdown(
        "مرحبا! تم إصلاح `reconnect.rs`\n\n```rust\nlet שלום = 1;\n```\n\nEnglish.",
        false,
    );
    let directions: Vec<TextDirection> = blocks.iter().map(|block| block.direction).collect();
    use TextDirection::*;
    assert_eq!(directions, [RightToLeft, LeftToRight, LeftToRight]);
}

#[test]
fn table_columns_are_analysed_for_layout() {
    let compared = table(include_str!("../../../tests/fixtures/format/02-tables.md"));
    let numeric: Vec<bool> = compared
        .columns
        .iter()
        .map(|column| column.numeric)
        .collect();
    assert_eq!(
        numeric,
        [false, true, true, false, false],
        "sizes and times are numbers"
    );
    let aligns: Vec<ColumnAlign> = compared.columns.iter().map(|column| column.align).collect();
    use ColumnAlign::*;
    assert_eq!(aligns, [Auto, End, End, Center, Auto]);
    assert_eq!(
        compared.columns[0].longest_cell, 21,
        "`A WebView with marked`"
    );
    assert_eq!(compared.columns[4].longest_word, 12, "`half-written`");
    assert!(compared.columns[3].short && !compared.columns[4].short);
    assert_eq!(compared.shape, TableShape::Grid);
    let key_value =
        table("| Key | Value |\n|---|---|\n| Route | LAN (192.168.1.24) |\n| Latency | 4 ms |");
    assert_eq!(key_value.shape, TableShape::KeyValue);
    let ragged = table("| a | b |\n|---|---|\n| `x \\| y` |\n| 1 | 2 | 3 |");
    assert!(
        ragged.rows.iter().all(|row| row.len() == 2),
        "short rows filled, long rows cut"
    );
    assert_eq!(ragged.rows[0][0].spans[0].text, "x | y");
}

#[test]
fn a_fence_names_its_file_and_text_fences_wrap() {
    let code = |text: &str| match format_markdown(text, false).remove(0).content {
        FormatContent::Code { code } => code,
        other => panic!("code, not {other:?}"),
    };
    let named = code("```swift Sources/App/BroskiApp.swift\n@main\n```");
    assert_eq!(named.language.as_deref(), Some("swift"));
    assert_eq!(named.file.as_deref(), Some("Sources/App/BroskiApp.swift"));
    assert!(!named.prose);
    assert!(code("```\nBuild failed\n```").prose);
    assert!(code("```log\nok\n```").prose);
    assert_eq!(
        code("```ts {1,3}\nx\n```").file,
        None,
        "attributes are not a file"
    );
}

#[test]
fn inline_html_stays_text_except_style_tags_and_line_breaks() {
    let cell = table("| a |\n|---|\n| one<br>two |");
    assert_eq!(cell.rows[0][0].spans[0].text, "one\ntwo");
    let keys = spans("press <kbd>⌘</kbd><kbd>K</kbd> or <script>x</script>");
    assert!(keys.iter().any(|span| span.code && span.text == "⌘K"));
    assert!(keys.iter().any(|span| span.html && span.text == "<script>"));
    let leaked = format_markdown("<system-reminder>\nnote\n</system-reminder>", false);
    assert!(
        matches!(&leaked[0].content, FormatContent::Html { text } if text.starts_with("<system-reminder>"))
    );
}

#[test]
fn footnotes_are_references_and_definitions() {
    let blocks = format_markdown("Cited[^1].\n\n[^1]: The source.", false);
    let reference = match &blocks[0].content {
        FormatContent::Paragraph { spans } => spans[1].link.clone(),
        _ => None,
    };
    assert_eq!(reference.map(|link| link.kind), Some(LinkKind::Footnote));
    assert_eq!(
        blocks[1].containers[0].kind,
        ContainerKind::Footnote {
            label: "1".to_owned()
        }
    );
}

#[test]
fn text_past_the_bound_is_one_plain_paragraph() {
    let text = format!("{}\n\ntail `x`", "a".repeat(MAX_FORMAT_BYTES));
    let last = format_markdown(&text, true).pop().expect("a last block");
    assert_eq!(last.key, format!("rest-{MAX_FORMAT_BYTES}"));
    assert!(
        matches!(&last.content, FormatContent::Paragraph { spans } if spans[0].text == "\n\ntail `x`")
    );
}

#[test]
fn every_gallery_sample_formats() {
    for sample in format_samples() {
        assert!(
            !format_markdown(&sample.text, false).is_empty(),
            "{}",
            sample.title
        );
    }
}

#[test]
fn only_the_cut_sample_arrives_and_streaming_repairs_what_it_cut() {
    let arriving: Vec<FormatSample> = format_samples()
        .into_iter()
        .filter(|sample| sample.arriving)
        .collect();
    assert_eq!(arriving.len(), 1);
    assert_eq!(arriving[0].title, "Cut mid-stream");
    assert_ne!(
        format_markdown(&arriving[0].text, true),
        format_markdown(&arriving[0].text, false)
    );
}

#[test]
fn the_persons_message_keeps_its_lines_as_typed_with_inline_styles_and_fenced_code() {
    let blocks = crate::format::format_message(
        "# not a heading\n- not a list **but bold**\n\n```sh\nls\n```\nafter",
    );
    let texts: Vec<String> = blocks
        .iter()
        .map(|block| match &block.content {
            FormatContent::Paragraph { spans } => {
                spans.iter().map(|span| span.text.as_str()).collect()
            }
            FormatContent::Code { code } => format!("code:{}", code.text),
            other => format!("{other:?}"),
        })
        .collect();
    assert_eq!(
        texts,
        ["# not a heading\n- not a list but bold", "code:ls", "after"]
    );
    assert!(matches!(&blocks[0].content, FormatContent::Paragraph { spans } if spans[1].strong));
}
