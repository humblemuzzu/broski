//! Formatted text copied back out: plain text, and a table as Markdown, CSV, TSV and HTML.

use crate::format::model::{FormatContent, FormatTable};
use crate::format::{
    format_markdown, format_plain_text, table_csv, table_html, table_markdown, table_tsv,
};

fn table(text: &str) -> FormatTable {
    match format_markdown(text, false).remove(0).content {
        FormatContent::Table { table } => table,
        other => panic!("a table, not {other:?}"),
    }
}

#[test]
fn plain_text_drops_the_markup_and_keeps_what_it_meant() {
    let text =
        "## Title\n\n- **one** [site](https://x.io)\n- two\n\n> [!NOTE]\n> Careful.\n\n1. `a`";
    assert_eq!(
        format_plain_text(text),
        "Title\n\n• one site (https://x.io)\n• two\n\nNote\nCareful.\n\n1. a"
    );
}

#[test]
fn a_table_copies_as_markdown_csv_tsv_and_html() {
    let parsed =
        table("| Name | Note |\n|:--|--:|\n| **a** | x, \"y\" |\n| `b\\|c` | two<br>lines |");
    assert_eq!(
        table_markdown(&parsed),
        "| Name | Note |\n| :--- | ---: |\n| **a** | x, \"y\" |\n| `b\\|c` | two<br>lines |"
    );
    assert_eq!(
        table_csv(&parsed),
        "Name,Note\na,\"x, \"\"y\"\"\"\nb|c,\"two\nlines\""
    );
    assert_eq!(
        table_tsv(&parsed),
        "Name\tNote\na\tx, \"y\"\nb|c\ttwo lines"
    );
    assert!(table_html(&parsed).contains("<tr><td>b|c</td><td>two<br>lines</td></tr>"));
}
