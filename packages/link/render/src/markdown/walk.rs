//! One pass over pulldown-cmark's events with their source offsets, keeping the open containers
//! and the block being built, and emitting each block as it closes.

use pulldown_cmark::{Alignment, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};

use super::{
    BlockContainer, BlockContent, ColumnAlignment, InlineRun, ListMarker, MarkdownBlock, TableCell,
    TableRow, MAX_CONTAINER_DEPTH,
};

pub(super) fn blocks(text: &str) -> Vec<MarkdownBlock> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut walker = Walker::default();
    for (event, range) in Parser::new_ext(text, options).into_offset_iter() {
        walker.event(event, range.start);
    }
    walker.close();
    walker.blocks
}

enum Open {
    Quote,
    Item { marker: ListMarker, used: bool },
}

enum Leaf {
    /// A paragraph or a heading; `implicit` for the text of a tight list item, which has no
    /// paragraph of its own.
    Inline {
        heading: Option<u8>,
        runs: Vec<InlineRun>,
        implicit: bool,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    Html {
        text: String,
    },
    Table {
        alignments: Vec<ColumnAlignment>,
        header: Option<TableRow>,
        rows: Vec<TableRow>,
        row: Vec<TableCell>,
        cell: Vec<InlineRun>,
    },
}

#[derive(Default)]
struct Style {
    strong: u32,
    emphasis: u32,
    strikethrough: u32,
    /// One entry per open link or image; `None` where the destination is not openable.
    links: Vec<Option<String>>,
}

/// What a tap may open: the model's text must not start an app by a URL scheme (`tel:`,
/// `intent:`, `file:`, `broski://pair`, `javascript:`). Anything else, a relative path included, is
/// plain text.
fn openable(url: &str) -> bool {
    const PREFIXES: [&str; 3] = ["http://", "https://", "mailto:"];
    PREFIXES.iter().any(|prefix| {
        url.get(..prefix.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(prefix))
    })
}

#[derive(Default)]
struct Walker {
    blocks: Vec<MarkdownBlock>,
    containers: Vec<Open>,
    /// The next number of each open list; `None` for a bullet list.
    lists: Vec<Option<u64>>,
    leaf: Option<(usize, Leaf)>,
    style: Style,
}

impl Walker {
    fn event(&mut self, event: Event<'_>, at: usize) {
        match event {
            Event::Start(tag) => self.start(tag, at),
            Event::End(tag) => self.end(tag),
            Event::Text(text) => self.text(&text, at),
            Event::Code(code) => self.inline(&code, true, at),
            Event::Html(html) => match &mut self.leaf {
                Some((_, Leaf::Html { text })) => text.push_str(&html),
                _ => self.inline(&html, false, at),
            },
            Event::InlineHtml(html) => self.inline(&html, false, at),
            Event::SoftBreak => self.inline(" ", false, at),
            Event::HardBreak => self.inline("\n", false, at),
            Event::Rule => {
                self.close_implicit();
                self.push(at, "hr", BlockContent::Rule);
            }
            Event::TaskListMarker(checked) => {
                if let Some(Open::Item { marker, .. }) = self.containers.last_mut() {
                    *marker = ListMarker::Task { checked };
                }
            }
            Event::FootnoteReference(_) | Event::InlineMath(_) | Event::DisplayMath(_) => {}
        }
    }

    fn start(&mut self, tag: Tag<'_>, at: usize) {
        match tag {
            Tag::Paragraph => self.open(at, inline(None)),
            Tag::Heading { level, .. } => self.open(at, inline(Some(level as u8))),
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => {
                        info.split_whitespace().next().map(str::to_owned)
                    }
                    CodeBlockKind::Indented => None,
                };
                let text = String::new();
                self.open(at, Leaf::Code { language, text });
            }
            Tag::HtmlBlock => self.open(
                at,
                Leaf::Html {
                    text: String::new(),
                },
            ),
            Tag::Table(alignments) => self.open(at, table(&alignments)),
            Tag::TableHead | Tag::TableRow => self.with_table(|row, _| row.clear()),
            Tag::TableCell => self.with_table(|_, cell| cell.clear()),
            Tag::BlockQuote(_) => {
                self.close_implicit();
                self.containers.push(Open::Quote);
            }
            Tag::List(start) => {
                self.close_implicit();
                self.lists.push(start);
            }
            Tag::Item => self.open_item(),
            Tag::Emphasis => self.style.emphasis += 1,
            Tag::Strong => self.style.strong += 1,
            Tag::Strikethrough => self.style.strikethrough += 1,
            Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. } => {
                self.style
                    .links
                    .push(openable(&dest_url).then(|| dest_url.into_string()));
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph
            | TagEnd::Heading(_)
            | TagEnd::CodeBlock
            | TagEnd::HtmlBlock
            | TagEnd::Table => self.close(),
            TagEnd::TableCell => self.with_table(|row, cell| {
                row.push(TableCell {
                    runs: std::mem::take(cell),
                })
            }),
            TagEnd::TableHead => self.end_row(true),
            TagEnd::TableRow => self.end_row(false),
            TagEnd::BlockQuote(_) | TagEnd::Item => {
                self.close_implicit();
                self.containers.pop();
            }
            TagEnd::List(_) => {
                self.close_implicit();
                self.lists.pop();
            }
            TagEnd::Emphasis => self.style.emphasis -= 1,
            TagEnd::Strong => self.style.strong -= 1,
            TagEnd::Strikethrough => self.style.strikethrough -= 1,
            TagEnd::Link | TagEnd::Image => {
                self.style.links.pop();
            }
            _ => {}
        }
    }

    fn open(&mut self, at: usize, leaf: Leaf) {
        self.close_implicit();
        self.leaf = Some((at, leaf));
    }

    fn open_item(&mut self) {
        self.close_implicit();
        let marker = match self.lists.last_mut() {
            Some(Some(next)) => {
                let value = *next;
                *next = next.saturating_add(1);
                ListMarker::Number { value }
            }
            _ => ListMarker::Bullet,
        };
        self.containers.push(Open::Item {
            marker,
            used: false,
        });
    }

    fn text(&mut self, text: &str, at: usize) {
        match &mut self.leaf {
            Some((_, Leaf::Code { text: code, .. })) => code.push_str(text),
            Some((_, Leaf::Html { text: html })) => html.push_str(text),
            _ => self.inline(text, false, at),
        }
    }

    /// Text in the current style, joined to the last run when that has the same style.
    fn inline(&mut self, text: &str, code: bool, at: usize) {
        if self.leaf.is_none() {
            self.leaf = Some((at, inline_implicit()));
        }
        let style = &self.style;
        let run = InlineRun {
            text: text.to_owned(),
            strong: style.strong > 0,
            emphasis: style.emphasis > 0,
            strikethrough: style.strikethrough > 0,
            code,
            link: style.links.last().cloned().flatten(),
        };
        let runs = match &mut self.leaf {
            Some((_, Leaf::Inline { runs, .. })) => runs,
            Some((_, Leaf::Table { cell, .. })) => cell,
            _ => return,
        };
        match runs.last_mut() {
            Some(last) if same_style(last, &run) => last.text.push_str(&run.text),
            _ => runs.push(run),
        }
    }

    fn with_table(&mut self, act: impl FnOnce(&mut Vec<TableCell>, &mut Vec<InlineRun>)) {
        if let Some((_, Leaf::Table { row, cell, .. })) = &mut self.leaf {
            act(row, cell);
        }
    }

    fn end_row(&mut self, head: bool) {
        if let Some((
            _,
            Leaf::Table {
                header, rows, row, ..
            },
        )) = &mut self.leaf
        {
            let done = TableRow {
                cells: std::mem::take(row),
            };
            if head {
                *header = Some(done);
            } else {
                rows.push(done);
            }
        }
    }

    fn close_implicit(&mut self) {
        if matches!(self.leaf, Some((_, Leaf::Inline { implicit: true, .. }))) {
            self.close();
        }
    }

    fn close(&mut self) {
        let Some((at, leaf)) = self.leaf.take() else {
            return;
        };
        let (kind, content) = match leaf {
            Leaf::Inline { runs, .. } if runs.is_empty() => return,
            Leaf::Inline {
                heading: Some(level),
                runs,
                ..
            } => ("h", BlockContent::Heading { level, runs }),
            Leaf::Inline { runs, .. } => ("p", BlockContent::Paragraph { runs }),
            Leaf::Code { language, mut text } => {
                if text.ends_with('\n') {
                    text.pop();
                }
                ("code", BlockContent::Code { language, text })
            }
            Leaf::Html { text } => {
                let text = text.trim_end_matches('\n').to_owned();
                ("html", BlockContent::Html { text })
            }
            Leaf::Table {
                alignments,
                header,
                rows,
                ..
            } => {
                let header = header.unwrap_or(TableRow { cells: Vec::new() });
                (
                    "table",
                    BlockContent::Table {
                        alignments,
                        header,
                        rows,
                    },
                )
            }
        };
        self.push(at, kind, content);
    }

    /// Emits a block inside the open containers; it is the first block of every item that had
    /// none yet.
    fn push(&mut self, at: usize, kind: &str, content: BlockContent) {
        let mut containers = Vec::new();
        for open in &mut self.containers {
            let container = match open {
                Open::Quote => BlockContainer::Quote,
                Open::Item { marker, used } => {
                    let first = !*used;
                    *used = true;
                    BlockContainer::ListItem {
                        marker: *marker,
                        first,
                    }
                }
            };
            if containers.len() < MAX_CONTAINER_DEPTH {
                containers.push(container);
            }
        }
        self.blocks.push(MarkdownBlock {
            key: format!("{kind}-{at}"),
            containers,
            content,
        });
    }
}

fn inline(heading: Option<u8>) -> Leaf {
    Leaf::Inline {
        heading,
        runs: Vec::new(),
        implicit: false,
    }
}

fn inline_implicit() -> Leaf {
    Leaf::Inline {
        heading: None,
        runs: Vec::new(),
        implicit: true,
    }
}

fn table(alignments: &[Alignment]) -> Leaf {
    let alignments = alignments
        .iter()
        .map(|alignment| match alignment {
            Alignment::None | Alignment::Left => ColumnAlignment::Leading,
            Alignment::Center => ColumnAlignment::Center,
            Alignment::Right => ColumnAlignment::Trailing,
        })
        .collect();
    Leaf::Table {
        alignments,
        header: None,
        rows: Vec::new(),
        row: Vec::new(),
        cell: Vec::new(),
    }
}

fn same_style(a: &InlineRun, b: &InlineRun) -> bool {
    a.strong == b.strong
        && a.emphasis == b.emphasis
        && a.strikethrough == b.strikethrough
        && a.code == b.code
        && a.link == b.link
}
