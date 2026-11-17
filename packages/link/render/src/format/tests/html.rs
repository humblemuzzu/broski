//! A test-only HTML writer of the block model, in the shape of the reference implementations'
//! output, so the official examples can check the parser. The apps never see HTML.

use std::collections::HashSet;

use super::html_inline::escape;
use crate::format::model::{
    ColumnAlign, ContainerKind, FormatBlock, FormatContainer, FormatContent, FormatSpacing,
    FormatSpan, FormatTable, ListMarker,
};

#[derive(Clone, PartialEq)]
enum Open {
    Quote(u32),
    List { id: u32, ordered: bool },
    Item(u32),
    Footnote(u32),
}

/// `gfm` writes bare URLs and addresses as links, as GitHub's extension does; CommonMark's
/// examples run without it.
pub(super) fn html(blocks: &[FormatBlock], gfm: bool) -> String {
    let loose = loose_lists(blocks);
    let mut writer = Writer {
        out: String::new(),
        open: Vec::new(),
        gfm,
    };
    for block in blocks {
        writer.containers(&block.containers);
        writer.block(block, &loose);
    }
    writer.containers(&[]);
    writer.out
}

/// The lists CommonMark calls loose: a blank line between two items, or between two blocks of
/// one item. The spacing step before a block says which gap it follows.
fn loose_lists(blocks: &[FormatBlock]) -> HashSet<u32> {
    let mut loose = HashSet::new();
    for pair in blocks.windows(2) {
        let (before, after) = (&pair[0].containers, &pair[1].containers);
        let shared = before
            .iter()
            .zip(after)
            .take_while(|(a, b)| a.id == b.id)
            .count();
        let sibling_item = match (before.get(shared), after.get(shared)) {
            (Some(a), Some(b)) => list_of(a).is_some() && list_of(a) == list_of(b),
            _ => false,
        };
        if sibling_item && pair[1].spacing == FormatSpacing::Loose {
            loose.extend(list_of(&after[shared]));
        } else if !sibling_item && shared > 0 && pair[1].spacing == FormatSpacing::Paragraph {
            loose.extend(list_of(&after[shared - 1]));
        }
    }
    loose
}

fn list_of(container: &FormatContainer) -> Option<u32> {
    match container.kind {
        ContainerKind::Item { list, .. } => Some(list),
        _ => None,
    }
}

pub(super) struct Writer {
    pub out: String,
    open: Vec<Open>,
    pub gfm: bool,
}

impl Writer {
    fn cr(&mut self) {
        if !self.out.is_empty() && !self.out.ends_with('\n') {
            self.out.push('\n');
        }
    }

    fn containers(&mut self, containers: &[FormatContainer]) {
        let wanted: Vec<Open> = containers.iter().flat_map(opens).collect();
        let shared = self
            .open
            .iter()
            .zip(&wanted)
            .take_while(|(a, b)| a == b)
            .count();
        while self.open.len() > shared {
            let closing = self.open.pop();
            self.close(closing);
        }
        for open in &wanted[shared..] {
            let container = containers.iter().find(|c| opens(c).contains(open));
            self.start(open, container);
        }
        self.open = wanted;
    }

    fn start(&mut self, open: &Open, container: Option<&FormatContainer>) {
        match open {
            Open::Quote(_) => {
                self.cr();
                self.out.push_str("<blockquote>\n");
            }
            Open::Footnote(_) => {
                self.cr();
                self.out.push_str("<section class=\"footnote\">\n");
            }
            Open::List { ordered, .. } => {
                self.cr();
                let start = container.and_then(|c| match &c.kind {
                    ContainerKind::Item {
                        marker: ListMarker::Number { value, .. },
                        ..
                    } => Some(*value),
                    _ => None,
                });
                match (ordered, start) {
                    (true, Some(start)) if start != 1 => {
                        self.out.push_str(&format!("<ol start=\"{start}\">\n"));
                    }
                    (true, _) => self.out.push_str("<ol>\n"),
                    (false, _) => self.out.push_str("<ul>\n"),
                }
            }
            Open::Item(_) => self.out.push_str("<li>"),
        }
    }

    fn close(&mut self, open: Option<Open>) {
        match open {
            Some(Open::Quote(_)) => {
                self.cr();
                self.out.push_str("</blockquote>\n");
            }
            Some(Open::Footnote(_)) => {
                self.cr();
                self.out.push_str("</section>\n");
            }
            Some(Open::List { ordered, .. }) => {
                self.cr();
                self.out
                    .push_str(if ordered { "</ol>\n" } else { "</ul>\n" });
            }
            Some(Open::Item(_)) => {
                self.out.push_str("</li>\n");
            }
            None => {}
        }
    }

    fn block(&mut self, block: &FormatBlock, loose: &HashSet<u32>) {
        let tight = block
            .containers
            .last()
            .and_then(list_of)
            .is_some_and(|list| !loose.contains(&list));
        let html = match &block.content {
            FormatContent::Paragraph { spans } => return self.paragraph(block, spans, tight),
            FormatContent::Table { table } => return self.table(table),
            FormatContent::Heading { level, spans } => {
                format!("<h{level}>{}</h{level}>", self.inline_html(spans))
            }
            FormatContent::Code { code } => {
                let class = code
                    .language
                    .as_ref()
                    .map(|language| format!(" class=\"language-{}\"", escape(language)))
                    .unwrap_or_default();
                let end = if code.text.is_empty() { "" } else { "\n" };
                format!("<pre><code{class}>{}{end}</code></pre>", escape(&code.text))
            }
            FormatContent::Math { tex } => format!("<div class=\"math\">{}</div>", escape(tex)),
            FormatContent::Html { text } => text.clone(),
            FormatContent::Rule => "<hr />".to_owned(),
        };
        self.cr();
        self.out.push_str(&html);
        self.cr();
    }

    fn inline_html(&mut self, spans: &[FormatSpan]) -> String {
        let before = self.out.len();
        self.inlines(spans);
        self.out.split_off(before)
    }

    fn paragraph(&mut self, block: &FormatBlock, spans: &[FormatSpan], tight: bool) {
        let task = self.task_prefix(block);
        if spans.is_empty() && task.is_empty() {
            return;
        }
        if !tight {
            self.cr();
            self.out.push_str("<p>");
        }
        self.out.push_str(&task);
        self.inlines(spans);
        if !tight {
            self.out.push_str("</p>");
            self.cr();
        }
    }

    fn table(&mut self, table: &FormatTable) {
        self.cr();
        self.out.push_str("<table>\n<thead>\n<tr>\n");
        for (cell, column) in table.header.iter().zip(&table.columns) {
            self.cell("th", &cell.spans, column.align);
        }
        self.out.push_str("</tr>\n</thead>\n");
        if !table.rows.is_empty() {
            self.out.push_str("<tbody>\n");
            for row in &table.rows {
                self.out.push_str("<tr>\n");
                for (cell, column) in row.iter().zip(&table.columns) {
                    self.cell("td", &cell.spans, column.align);
                }
                self.out.push_str("</tr>\n");
            }
            self.out.push_str("</tbody>\n");
        }
        self.out.push_str("</table>\n");
    }

    fn task_prefix(&self, block: &FormatBlock) -> String {
        match block.containers.last() {
            Some(FormatContainer {
                kind:
                    ContainerKind::Item {
                        marker: ListMarker::Task { checked },
                        ..
                    },
                first: true,
                ..
            }) => {
                let checked = if *checked { "checked=\"\" " } else { "" };
                format!("<input {checked}disabled=\"\" type=\"checkbox\"> ")
            }
            _ => String::new(),
        }
    }

    fn cell(&mut self, tag: &str, spans: &[FormatSpan], align: ColumnAlign) {
        let align = match align {
            ColumnAlign::Auto => "",
            ColumnAlign::Start => " align=\"left\"",
            ColumnAlign::Center => " align=\"center\"",
            ColumnAlign::End => " align=\"right\"",
        };
        self.out.push_str(&format!("<{tag}{align}>"));
        self.inlines(spans);
        self.out.push_str(&format!("</{tag}>\n"));
    }
}

fn opens(container: &FormatContainer) -> Vec<Open> {
    match &container.kind {
        ContainerKind::Quote | ContainerKind::Callout { .. } => vec![Open::Quote(container.id)],
        ContainerKind::Footnote { .. } => vec![Open::Footnote(container.id)],
        ContainerKind::Item { list, marker, .. } => vec![
            Open::List {
                id: *list,
                ordered: matches!(marker, ListMarker::Number { .. }),
            },
            Open::Item(container.id),
        ],
    }
}
