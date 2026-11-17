//! The formatting plan's edge cases (§6) the samples do not already hold: tables at their extremes,
//! a code line far wider than any screen, lists nested past what a phone indents, and markers
//! mixed in one answer.

use crate::format::format_markdown;
use crate::format::model::*;

fn table(text: &str) -> FormatTable {
    format_markdown(text, false)
        .into_iter()
        .find_map(|block| match block.content {
            FormatContent::Table { table } => Some(table),
            _ => None,
        })
        .expect("a table")
}

fn row(cells: &[String]) -> String {
    format!("| {} |", cells.join(" | "))
}

#[test]
fn fifteen_columns_five_hundred_rows_and_a_long_cell_stay_one_whole_table() {
    let header: Vec<String> = (1..=15).map(|n| format!("c{n}")).collect();
    let rule = vec!["---".to_owned(); 15];
    let mut text = vec![row(&header), row(&rule)];
    let long = "word ".repeat(60).trim_end().to_owned();
    for n in 0..500 {
        let mut cells: Vec<String> = (1..=15).map(|c| format!("{n}.{c}")).collect();
        if n == 0 {
            cells[3] = long.clone();
        }
        text.push(row(&cells));
    }
    let table = table(&text.join("\n"));
    assert_eq!((table.columns.len(), table.rows.len()), (15, 500));
    assert!(table.rows.iter().all(|cells| cells.len() == 15));
    assert_eq!(table.columns[3].longest_cell, 299);
    assert_eq!(
        table.columns[3].longest_word,
        "499.4".len() as u32,
        "its words, not its long cell"
    );
    assert!(!table.columns[3].short && table.columns[0].numeric);
}

#[test]
fn a_table_with_an_empty_header_keeps_its_columns_and_rows() {
    let table = table("|  |  |\n|---|---|\n| a | b |\n| c | d |");
    assert_eq!(table.columns.len(), 2);
    assert!(table.header.iter().all(|cell| cell.spans.is_empty()));
    assert_eq!(table.rows.len(), 2);
}

#[test]
fn a_four_thousand_character_line_is_one_code_line_kept_whole() {
    let line = "x".repeat(4_000);
    let blocks = format_markdown(&format!("```ts\n{line}\nshort\n```"), false);
    let FormatContent::Code { code } = &blocks[0].content else {
        panic!("a code block: {:?}", blocks[0]);
    };
    let lines: Vec<&str> = code.text.split('\n').collect();
    assert_eq!(lines, [line.as_str(), "short"]);
    assert!(!code.prose, "code scrolls sideways rather than wrapping");
}

#[test]
fn eight_levels_of_list_keep_their_depth_and_text() {
    let text = (0..8)
        .map(|depth| format!("{}- level {depth}", "  ".repeat(depth)))
        .collect::<Vec<_>>()
        .join("\n");
    let blocks = format_markdown(&text, false);
    assert_eq!(blocks.len(), 8);
    for (depth, block) in blocks.iter().enumerate() {
        let item = block.containers.last().expect("an item");
        assert!(
            matches!(item.kind, ContainerKind::Item { depth: found, .. } if found as usize == depth),
            "{block:?}"
        );
        assert_eq!(block.containers.len(), depth + 1);
    }
}

#[test]
fn bullets_numbers_and_tasks_mixed_in_one_answer_are_each_their_own_list() {
    let blocks = format_markdown(
        "- one\n- two\n\n1. first\n2) second\n\n- [ ] todo\n- [x] done\n\n* star",
        false,
    );
    let markers: Vec<(u32, ListMarker)> = blocks
        .iter()
        .filter_map(|block| match &block.containers.last()?.kind {
            ContainerKind::Item { list, marker, .. } => Some((*list, marker.clone())),
            _ => None,
        })
        .collect();
    let lists: Vec<u32> = markers.iter().map(|(list, _)| *list).collect();
    let distinct = lists.windows(2).filter(|pair| pair[0] != pair[1]).count() + 1;
    assert_eq!(
        distinct, 5,
        "a change of marker starts a new list: {markers:?}"
    );
    assert!(matches!(
        markers[2].1,
        ListMarker::Number {
            value: 1,
            paren: false
        }
    ));
    assert!(matches!(
        markers[3].1,
        ListMarker::Number {
            value: 2,
            paren: true
        }
    ));
    assert!(matches!(markers[5].1, ListMarker::Task { checked: true }));
}
