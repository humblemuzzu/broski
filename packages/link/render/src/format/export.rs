//! Formatted text back out as text: plain (Copy as plain text, previews), and a table as Markdown,
//! CSV, TSV or HTML (its copy, and the pasteboard's rich copy).

use super::model::{
    CalloutKind, ContainerKind, FormatBlock, FormatContent, FormatSpacing, FormatSpan, FormatTable,
    LinkKind, ListMarker, TableCell,
};
use super::tables::plain;

/// `text` with its markup gone: list markers as `•` and numbers, a link's address after its label,
/// a table as tab-separated rows, a callout under its title.
pub fn format_plain_text(text: &str) -> String {
    plain_text(&super::format_markdown(text, false), true)
}

/// The blocks' words; `addresses` writes each written link's address after its label.
pub(crate) fn plain_text(blocks: &[FormatBlock], addresses: bool) -> String {
    let mut out = String::new();
    for (index, block) in blocks.iter().enumerate() {
        if !out.is_empty() {
            let same_list = index > 0 && same_item_list(&blocks[index - 1], block);
            out.push_str(match block.spacing {
                FormatSpacing::Tight | FormatSpacing::LeadIn => "\n",
                FormatSpacing::Loose | FormatSpacing::AfterGroup if same_list => "\n",
                _ => "\n\n",
            });
        }
        let (prefix, indent) = prefixes(block);
        let body = block_text(&block.content, addresses);
        for (index, line) in body.split('\n').enumerate() {
            if index > 0 {
                out.push('\n');
            }
            out.push_str(if index == 0 { &prefix } else { &indent });
            out.push_str(line);
        }
    }
    out
}

fn same_item_list(a: &FormatBlock, b: &FormatBlock) -> bool {
    let list_id = |block: &FormatBlock| {
        block.containers.last().and_then(|c| match c.kind {
            ContainerKind::Item { list, .. } => Some(list),
            _ => None,
        })
    };
    list_id(a).is_some() && list_id(a) == list_id(b)
}

/// The text before a block's first line (a callout's title line, a list marker) and before its
/// other lines.
fn prefixes(block: &FormatBlock) -> (String, String) {
    let mut first = String::new();
    let mut rest = String::new();
    for container in &block.containers {
        match &container.kind {
            ContainerKind::Callout { kind } if container.first => {
                first.push_str(callout_title(*kind));
                first.push('\n');
                first.push_str(&rest);
            }
            ContainerKind::Item { marker, depth, .. } => {
                let indent = "  ".repeat(*depth as usize);
                let marker = marker_text(marker);
                if container.first {
                    first = format!("{first}{indent}{marker} ");
                } else {
                    first = format!("{first}{indent}{} ", " ".repeat(marker.chars().count()));
                }
                rest = format!("{rest}{indent}{} ", " ".repeat(marker.chars().count()));
            }
            _ => {}
        }
    }
    (first, rest)
}

fn marker_text(marker: &ListMarker) -> String {
    match marker {
        ListMarker::Bullet => "•".to_owned(),
        ListMarker::Number { value, paren } => format!("{value}{}", if *paren { ")" } else { "." }),
        ListMarker::Task { checked: true } => "☑".to_owned(),
        ListMarker::Task { checked: false } => "☐".to_owned(),
    }
}

fn callout_title(kind: CalloutKind) -> &'static str {
    match kind {
        CalloutKind::Note => "Note",
        CalloutKind::Tip => "Tip",
        CalloutKind::Important => "Important",
        CalloutKind::Warning => "Warning",
        CalloutKind::Caution => "Caution",
        CalloutKind::Insight => "Insight",
    }
}

fn block_text(content: &FormatContent, addresses: bool) -> String {
    match content {
        FormatContent::Paragraph { spans } | FormatContent::Heading { spans, .. } => {
            spans_text(spans, addresses)
        }
        FormatContent::Code { code } => code.text.clone(),
        FormatContent::Table { table } => table_tsv(table),
        FormatContent::Math { tex } => tex.clone(),
        FormatContent::Html { text } => text.clone(),
        FormatContent::Rule => "———".to_owned(),
    }
}

fn spans_text(spans: &[FormatSpan], addresses: bool) -> String {
    let mut out = String::new();
    for span in spans {
        match &span.link {
            Some(link) if link.bare && link.kind == LinkKind::Web => out.push_str(&link.target),
            Some(link)
                if addresses
                    && !link.bare
                    && matches!(link.kind, LinkKind::Web | LinkKind::Mail) =>
            {
                let address = link.target.strip_prefix("mailto:").unwrap_or(&link.target);
                out.push_str(&span.text);
                if span.text != address {
                    out.push_str(&format!(" ({address})"));
                }
            }
            _ => out.push_str(&span.text),
        }
    }
    out
}

/// The table as GitHub Markdown, its cells' styles and links written back.
pub fn table_markdown(table: &FormatTable) -> String {
    let row = |cells: &[TableCell]| {
        let cells: Vec<String> = cells
            .iter()
            .map(|cell| cell_markdown(&cell.spans))
            .collect();
        format!("| {} |", cells.join(" | "))
    };
    let delimiters: Vec<&str> = table
        .columns
        .iter()
        .map(|column| match column.align {
            super::model::ColumnAlign::Auto => "---",
            super::model::ColumnAlign::Start => ":---",
            super::model::ColumnAlign::Center => ":---:",
            super::model::ColumnAlign::End => "---:",
        })
        .collect();
    let mut lines = vec![
        row(&table.header),
        format!("| {} |", delimiters.join(" | ")),
    ];
    lines.extend(table.rows.iter().map(|cells| row(cells)));
    lines.join("\n")
}

fn cell_markdown(spans: &[FormatSpan]) -> String {
    let mut out = String::new();
    for span in spans {
        let text = span.text.replace('|', "\\|").replace('\n', "<br>");
        let mut piece = if span.code { format!("`{text}`") } else { text };
        if span.strike {
            piece = format!("~~{piece}~~");
        }
        if span.emphasis {
            piece = format!("*{piece}*");
        }
        if span.strong {
            piece = format!("**{piece}**");
        }
        if let Some(link) = span
            .link
            .as_ref()
            .filter(|link| !link.bare && link.kind != LinkKind::Footnote)
        {
            piece = format!("[{piece}]({})", link.target);
        }
        out.push_str(&piece);
    }
    out
}

/// The table as comma-separated values (RFC 4180): a cell with a comma, a quote or a line break
/// is quoted, its quotes doubled.
pub fn table_csv(table: &FormatTable) -> String {
    rows_text(table, ",", |text| {
        if text.contains([',', '"', '\n']) {
            format!("\"{}\"", text.replace('"', "\"\""))
        } else {
            text.to_owned()
        }
    })
}

/// The table as tab-separated rows; a cell's tabs and line breaks become spaces.
pub fn table_tsv(table: &FormatTable) -> String {
    rows_text(table, "\t", |text| text.replace(['\t', '\n'], " "))
}

/// The table as an HTML table, so a paste into Notes or a mail keeps it a table.
pub fn table_html(table: &FormatTable) -> String {
    let escape = |text: &str| {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('\n', "<br>")
    };
    let row = |cells: &[TableCell], tag: &str| {
        let cells: String = cells
            .iter()
            .map(|cell| format!("<{tag}>{}</{tag}>", escape(&plain(&cell.spans))))
            .collect();
        format!("<tr>{cells}</tr>")
    };
    let body: String = table.rows.iter().map(|cells| row(cells, "td")).collect();
    format!(
        "<table><thead>{}</thead><tbody>{body}</tbody></table>",
        row(&table.header, "th")
    )
}

fn rows_text(table: &FormatTable, separator: &str, cell: impl Fn(&str) -> String) -> String {
    std::iter::once(&table.header)
        .chain(&table.rows)
        .map(|cells| {
            cells
                .iter()
                .map(|value| cell(&plain(&value.spans)))
                .collect::<Vec<_>>()
                .join(separator)
        })
        .collect::<Vec<_>>()
        .join("\n")
}
