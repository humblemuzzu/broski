use super::*;

fn run(text: &str) -> InlineRun {
    InlineRun::plain(text)
}

fn styled(text: &str, style: impl FnOnce(&mut InlineRun)) -> InlineRun {
    let mut run = run(text);
    style(&mut run);
    run
}

fn paragraph(runs: Vec<InlineRun>) -> BlockContent {
    BlockContent::Paragraph { runs }
}

fn contents(text: &str) -> Vec<BlockContent> {
    markdown_blocks(text)
        .into_iter()
        .map(|block| block.content)
        .collect()
}

fn item(marker: ListMarker, first: bool) -> BlockContainer {
    BlockContainer::ListItem { marker, first }
}

#[test]
fn an_agent_reply_with_a_heading_a_list_and_code() {
    let text = "## Plan\n\nI'll fix the **flaky** test in `auth.ts`:\n\n1. Read the test\n2. Run `npm test`\n\n```ts\nconst a = 1;\n```\n";
    let blocks = markdown_blocks(text);
    let contents: Vec<_> = blocks.iter().map(|block| block.content.clone()).collect();
    assert_eq!(
        contents,
        [
            BlockContent::Heading {
                level: 2,
                runs: vec![run("Plan")]
            },
            paragraph(vec![
                run("I'll fix the "),
                styled("flaky", |run| run.strong = true),
                run(" test in "),
                styled("auth.ts", |run| run.code = true),
                run(":"),
            ]),
            paragraph(vec![run("Read the test")]),
            paragraph(vec![run("Run "), styled("npm test", |run| run.code = true)]),
            BlockContent::Code {
                language: Some("ts".to_owned()),
                text: "const a = 1;".to_owned()
            },
        ]
    );
    assert_eq!(
        blocks[2].containers,
        [item(ListMarker::Number { value: 1 }, true)]
    );
    assert_eq!(
        blocks[3].containers,
        [item(ListMarker::Number { value: 2 }, true)]
    );
    assert!(blocks[4].containers.is_empty());
}

/// Each block as `<kind>@<containers>`: `q` a quote, `-` a bullet, `1.` a number, `[x]` a task,
/// `+` a continued item.
fn shape(text: &str) -> Vec<String> {
    markdown_blocks(text)
        .iter()
        .map(|block| {
            let kind = match &block.content {
                BlockContent::Paragraph { .. } => "p".to_owned(),
                BlockContent::Heading { level, .. } => format!("h{level}"),
                BlockContent::Code { language, .. } => {
                    format!("code:{}", language.as_deref().unwrap_or(""))
                }
                BlockContent::Table { rows, .. } => format!("table{}", rows.len()),
                BlockContent::Rule => "hr".to_owned(),
                BlockContent::Html { .. } => "html".to_owned(),
            };
            let path: String = block
                .containers
                .iter()
                .map(|container| match container {
                    BlockContainer::Quote => "q".to_owned(),
                    BlockContainer::ListItem { first: false, .. } => "+".to_owned(),
                    BlockContainer::ListItem { marker, .. } => match marker {
                        ListMarker::Bullet => "-".to_owned(),
                        ListMarker::Number { value } => format!("{value}."),
                        ListMarker::Task { checked: true } => "[x]".to_owned(),
                        ListMarker::Task { checked: false } => "[ ]".to_owned(),
                    },
                })
                .collect();
            format!("{kind}@{path}")
        })
        .collect()
}

#[test]
fn messages_agents_write_take_the_shape_a_reader_sees() {
    let cases: &[(&str, &[&str])] = &[
        (
            "Done. I changed three files:\n\n- `src/auth.ts` — token refresh\n  - retries twice\n- `README.md`\n\nRun `bun test` to check.",
            &["p@", "p@-", "p@+-", "p@-", "p@"],
        ),
        (
            "## Summary\n\n| File | Change |\n|---|---|\n| a.rs | +3 |\n| b.rs | -1 |\n\n> **Note:** tests pass.",
            &["h2@", "table2@", "p@q"],
        ),
        (
            "Steps:\n\n1. Install\n\n   ```bash\n   npm i\n   ```\n2. Build\n\n---\n\n- [x] lint\n- [ ] deploy",
            &["p@", "p@1.", "code:bash@+", "p@2.", "hr@", "p@[x]", "p@[ ]"],
        ),
        (
            "```diff\n-old\n+new\n```\n\nThe fix is in `parse()`; see <https://example.com/issue/1>.",
            &["code:diff@", "p@"],
        ),
        ("# Heading only", &["h1@"]),
        ("```\nunterminated fence while streaming", &["code:@"]),
        ("", &[]),
    ];
    for (text, expected) in cases {
        assert_eq!(shape(text), *expected, "{text:?}");
    }
}

#[test]
fn an_ordered_list_counts_from_its_start_and_bullets_nest() {
    let blocks = markdown_blocks("3. three\n4. four\n   - inner\n");
    let containers: Vec<_> = blocks
        .iter()
        .map(|block| block.containers.clone())
        .collect();
    assert_eq!(
        containers,
        [
            vec![item(ListMarker::Number { value: 3 }, true)],
            vec![item(ListMarker::Number { value: 4 }, true)],
            vec![
                item(ListMarker::Number { value: 4 }, false),
                item(ListMarker::Bullet, true)
            ],
        ]
    );
}

#[test]
fn a_list_item_with_two_paragraphs_shows_its_marker_once() {
    let blocks = markdown_blocks("- first\n\n  second\n- next\n");
    let firsts: Vec<_> = blocks
        .iter()
        .map(|block| match block.containers.as_slice() {
            [BlockContainer::ListItem { first, .. }] => *first,
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(firsts, [true, false, true]);
}

#[test]
fn a_nested_list_opening_an_item_shares_its_first_line() {
    let blocks = markdown_blocks("- - deep\n");
    assert_eq!(
        blocks[0].containers,
        [
            item(ListMarker::Bullet, true),
            item(ListMarker::Bullet, true)
        ]
    );
}

#[test]
fn task_items_carry_their_state_tight_or_loose() {
    for text in ["- [x] done\n- [ ] todo\n", "- [x] done\n\n- [ ] todo\n"] {
        let blocks = markdown_blocks(text);
        let markers: Vec<_> = blocks
            .iter()
            .map(|block| block.containers.clone())
            .collect();
        assert_eq!(
            markers,
            [
                vec![item(ListMarker::Task { checked: true }, true)],
                vec![item(ListMarker::Task { checked: false }, true)],
            ],
            "{text:?}"
        );
        assert_eq!(blocks[0].content, paragraph(vec![run("done")]));
    }
}

#[test]
fn a_quote_holds_its_blocks_and_nests() {
    let blocks = markdown_blocks("> outer\n>\n> > inner\n");
    assert_eq!(blocks[0].containers, [BlockContainer::Quote]);
    assert_eq!(
        blocks[1].containers,
        [BlockContainer::Quote, BlockContainer::Quote]
    );
    assert_eq!(blocks[1].content, paragraph(vec![run("inner")]));
}

#[test]
fn a_table_keeps_alignment_header_and_rows_of_runs() {
    let text = "| Name | Size |  Left |\n|:----:|-----:|:------|\n| `a.rs` | 1 KB | x |\n| **b** | 2 KB | y |\n";
    let [BlockContent::Table {
        alignments,
        header,
        rows,
    }] = <[BlockContent; 1]>::try_from(contents(text)).expect("one block")
    else {
        panic!("not a table");
    };
    assert_eq!(
        alignments,
        [
            ColumnAlignment::Center,
            ColumnAlignment::Trailing,
            ColumnAlignment::Leading
        ]
    );
    let cell = |runs: Vec<InlineRun>| TableCell { runs };
    assert_eq!(
        header.cells,
        [
            cell(vec![run("Name")]),
            cell(vec![run("Size")]),
            cell(vec![run("Left")])
        ]
    );
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].cells[0],
        cell(vec![styled("a.rs", |run| run.code = true)])
    );
    assert_eq!(
        rows[1].cells[0],
        cell(vec![styled("b", |run| run.strong = true)])
    );
}

#[test]
fn inline_styles_nest_and_links_carry_their_destination() {
    let runs = match &contents(
        "***both*** ~~gone~~ [docs](https://x.dev) <https://a.b> ![logo](l.png)",
    )[0]
    {
        BlockContent::Paragraph { runs } => runs.clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(
        runs,
        [
            styled("both", |run| {
                run.strong = true;
                run.emphasis = true;
            }),
            run(" "),
            styled("gone", |run| run.strikethrough = true),
            run(" "),
            styled("docs", |run| run.link = Some("https://x.dev".to_owned())),
            run(" "),
            styled("https://a.b", |run| run.link =
                Some("https://a.b".to_owned())),
            run(" "),
            styled("logo", |run| run.link = Some("l.png".to_owned())),
        ]
    );
}

#[test]
fn breaks_rules_html_and_indented_code() {
    let text = "soft\nbreak and hard  \nbreak\n\n---\n\n<div>\nhi\n</div>\n\n    indented\n";
    assert_eq!(
        contents(text),
        [
            paragraph(vec![run("soft break and hard\nbreak")]),
            BlockContent::Rule,
            BlockContent::Html {
                text: "<div>\nhi\n</div>".to_owned()
            },
            BlockContent::Code {
                language: None,
                text: "indented".to_owned()
            },
        ]
    );
}

#[test]
fn commonmark_examples_parse_as_the_spec_says() {
    // Spec 0.31.2, example 62 (setext heading), 119 (fence with info words), 307 (lazy list).
    assert_eq!(
        contents("Foo *bar*\n=========\n"),
        [BlockContent::Heading {
            level: 1,
            runs: vec![run("Foo "), styled("bar", |run| run.emphasis = true)]
        }]
    );
    assert_eq!(
        contents("``` ruby startline=3 $%@#$\ndef foo(x)\n  return 3\nend\n```\n"),
        [BlockContent::Code {
            language: Some("ruby".to_owned()),
            text: "def foo(x)\n  return 3\nend".to_owned()
        }]
    );
    assert_eq!(contents("<b>*no*</b>\n").len(), 1);
}

#[test]
fn keys_of_earlier_blocks_hold_while_the_text_streams() {
    let text = "# Title\n\nFirst paragraph with **bold** text.\n\n- one\n- two\n\n```rust\nfn main() {}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nLast words.";
    let mut previous: Vec<MarkdownBlock> = Vec::new();
    for end in (1..=text.len()).filter(|&end| text.is_char_boundary(end)) {
        let blocks = markdown_blocks(&text[..end]);
        let keyed = previous.len().saturating_sub(1);
        let key = |block: &MarkdownBlock| block.key.clone();
        let keys: Vec<_> = blocks.iter().take(keyed).map(key).collect();
        let before: Vec<_> = previous.iter().take(keyed).map(key).collect();
        assert_eq!(keys, before, "at {end}: a key before the last changed");
        let settled = previous.len().saturating_sub(2);
        assert_eq!(
            blocks[..settled],
            previous[..settled],
            "at {end}: a block before the last two changed"
        );
        let keys: std::collections::HashSet<_> = blocks.iter().map(|block| &block.key).collect();
        assert_eq!(keys.len(), blocks.len(), "at {end}: keys are unique");
        previous = blocks;
    }
    let keys: Vec<_> = previous.iter().map(|block| block.key.as_str()).collect();
    assert_eq!(
        keys,
        ["h-0", "p-9", "p-48", "p-54", "code-59", "table-85", "p-116"]
    );
}

#[test]
fn a_list_turning_loose_keeps_its_items_keys() {
    let tight = markdown_blocks("- a\n- b\n");
    let loose = markdown_blocks("- a\n- b\n\n- c\n");
    assert_eq!(tight[0].key, loose[0].key);
    assert_eq!(tight[1].key, loose[1].key);
}

#[test]
fn text_past_the_bound_is_one_plain_paragraph() {
    let mut text = "*a* ".repeat(MAX_MARKDOWN_BYTES / 4);
    text.push_str("**not parsed**");
    let blocks = markdown_blocks(&text);
    let last = blocks.last().expect("blocks");
    assert_eq!(last.key, format!("rest-{MAX_MARKDOWN_BYTES}"));
    assert_eq!(last.content, paragraph(vec![run("**not parsed**")]));
}

#[test]
fn deep_nesting_is_cut_at_the_container_bound() {
    let text = format!("{}deep\n", "> ".repeat(MAX_CONTAINER_DEPTH * 4));
    let blocks = markdown_blocks(&text);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].containers.len(), MAX_CONTAINER_DEPTH);
    assert_eq!(blocks[0].content, paragraph(vec![run("deep")]));
}
