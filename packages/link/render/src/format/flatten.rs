//! The block tree as the flat list the apps lay out: each leaf with the containers around it, its
//! key, the space before it and its content, inlines parsed.

use super::block::tree::{Kind, ListData, Node};
use super::block::Tree;
use super::model::{
    ContainerKind, FormatBlock, FormatContainer, FormatContent, FormatSpacing, ListMarker,
};
use super::{direction, leaves};

pub(crate) fn blocks(tree: &Tree, streaming: bool) -> Vec<FormatBlock> {
    let (last_leaf, held) = if streaming {
        streaming_end(&tree.nodes)
    } else {
        (None, Vec::new())
    };
    let mut walk = Walk {
        tree,
        out: Vec::new(),
        stack: Vec::new(),
        held,
        last_leaf,
        task_paragraph: None,
    };
    walk.children(0, FormatSpacing::None);
    walk.out
}

struct Walk<'a> {
    tree: &'a Tree,
    out: Vec<FormatBlock>,
    /// The containers around the current node, each with whether a block has been drawn in it.
    stack: Vec<(FormatContainer, bool)>,
    /// The leaves at the end held back whole while streaming.
    held: Vec<usize>,
    /// The leaf still being written while streaming: only it is repaired.
    last_leaf: Option<usize>,
    /// The paragraph whose leading `[ ]` became its task item's marker.
    task_paragraph: Option<usize>,
}

/// The leaf still being written, and the leaves after it held back whole (table rows before their
/// delimiter row): the reader sees the leaf before those as the one being written.
fn streaming_end(nodes: &[Node]) -> (Option<usize>, Vec<usize>) {
    let mut order = Vec::new();
    leaves_in_order(nodes, 0, &mut order);
    let shown = order
        .iter()
        .rposition(|&node| !leaves::held_back(&nodes[node]))
        .map_or(0, |at| at + 1);
    let held = order.split_off(shown);
    (order.last().copied(), held)
}

fn leaves_in_order(nodes: &[Node], node: usize, order: &mut Vec<usize>) {
    if node != 0 && nodes[node].children.is_empty() {
        order.push(node);
    }
    for &child in &nodes[node].children {
        leaves_in_order(nodes, child, order);
    }
}

impl Walk<'_> {
    fn node(&self, index: usize) -> &Node {
        &self.tree.nodes[index]
    }

    fn children(&mut self, parent: usize, first_spacing: FormatSpacing) {
        let children = self.node(parent).children.clone();
        for (index, &child) in children.iter().enumerate() {
            let spacing = match index.checked_sub(1) {
                None => first_spacing,
                Some(before) => self.gap(parent, children[before], child),
            };
            self.visit(child, spacing);
        }
    }

    /// The space between two neighbouring children of `parent`.
    fn gap(&self, parent: usize, before: usize, after: usize) -> FormatSpacing {
        let blank = self.node(before).end_line + 1 < self.node(after).start_line;
        let previous = &self.node(before).kind;
        let next = &self.node(after).kind;
        match self.node(parent).kind {
            Kind::List(_) if blank => FormatSpacing::Loose,
            Kind::List(_) if self.has_nested_blocks(before) => FormatSpacing::AfterGroup,
            Kind::List(_) => FormatSpacing::Tight,
            Kind::Item(_) | Kind::Footnote(_) if blank => FormatSpacing::Paragraph,
            Kind::Item(_) | Kind::Footnote(_) if is_framed(previous) || is_framed(next) => {
                FormatSpacing::AfterGroup
            }
            Kind::Item(_) | Kind::Footnote(_) => FormatSpacing::Tight,
            _ if matches!(previous, Kind::Rule) || matches!(next, Kind::Rule) => {
                FormatSpacing::Rule
            }
            _ if matches!(previous, Kind::Heading(_))
                && (matches!(next, Kind::Heading(_)) || is_framed(next)) =>
            {
                FormatSpacing::StackedHeading
            }
            _ if matches!(previous, Kind::Heading(_)) => FormatSpacing::AfterHeading,
            _ if matches!(next, Kind::Heading(1 | 2)) => FormatSpacing::Section,
            _ if matches!(next, Kind::Heading(_)) => FormatSpacing::SubSection,
            _ if matches!(previous, Kind::Paragraph) && matches!(next, Kind::List(_)) => {
                if blank {
                    FormatSpacing::Loose
                } else {
                    FormatSpacing::LeadIn
                }
            }
            _ if is_framed(previous) || is_framed(next) => FormatSpacing::Block,
            _ => FormatSpacing::Paragraph,
        }
    }

    /// An item that holds nested structure (a sub-list, a second paragraph, a code block): the next
    /// sibling item is set apart so groups read clearly without erratic single-line spacing jumps.
    fn has_nested_blocks(&self, item: usize) -> bool {
        self.node(item).children.len() > 1
    }

    fn visit(&mut self, node: usize, spacing: FormatSpacing) {
        let kind = match &self.node(node).kind {
            Kind::Quote => ContainerKind::Quote,
            Kind::Callout(kind) => ContainerKind::Callout { kind: *kind },
            Kind::Insight => ContainerKind::Callout {
                kind: super::model::CalloutKind::Insight,
            },
            Kind::Footnote(label) => ContainerKind::Footnote {
                label: label.clone(),
            },
            Kind::List(data) => {
                let data = *data;
                return self.list(node, data, spacing);
            }
            _ => return self.leaf(node, spacing),
        };
        self.container(node, kind, spacing);
    }

    fn list(&mut self, list: usize, data: ListData, spacing: FormatSpacing) {
        let items = self.node(list).children.clone();
        let depth = self
            .stack
            .iter()
            .filter(|(container, _)| matches!(container.kind, ContainerKind::Item { .. }))
            .count();
        let width = marker_width(&data, items.len());
        for (index, &item) in items.iter().enumerate() {
            let spacing = match index.checked_sub(1) {
                None => spacing,
                Some(before) => self.gap(list, items[before], item),
            };
            let marker = match self.task(item) {
                Some(checked) => ListMarker::Task { checked },
                None if data.bullet.is_some() => ListMarker::Bullet,
                None => ListMarker::Number {
                    value: data.start.saturating_add(index as u64),
                    paren: data.delimiter == b')',
                },
            };
            let kind = ContainerKind::Item {
                list: offset(self.node(list).start),
                marker,
                depth: u32::try_from(depth).unwrap_or(u32::MAX),
                width,
            };
            self.container(item, kind, spacing);
        }
    }

    /// Whether an item is a task (`[ ]` or `[x]` before its first paragraph's text), and checked.
    fn task(&mut self, item: usize) -> Option<bool> {
        let first = *self.node(item).children.first()?;
        let node = self.node(first);
        if !matches!(node.kind, Kind::Paragraph) {
            return None;
        }
        let checked = leaves::task_marker(&node.text)?;
        self.task_paragraph = Some(first);
        Some(checked)
    }

    fn container(&mut self, node: usize, kind: ContainerKind, spacing: FormatSpacing) {
        let container = FormatContainer {
            id: offset(self.node(node).start),
            kind,
            first: true,
        };
        self.stack.push((container, false));
        let before = self.out.len();
        self.children(node, spacing);
        if self.out.len() == before {
            let key = format!("p-{}", self.node(node).start);
            self.emit(key, spacing, FormatContent::Paragraph { spans: Vec::new() });
        }
        self.stack.pop();
    }

    fn leaf(&mut self, node: usize, spacing: FormatSpacing) {
        let streaming = self.last_leaf == Some(node) || self.held.contains(&node);
        let task = self.task_paragraph == Some(node);
        let Some((kind, content)) =
            leaves::content(self.node(node), &self.tree.refs, streaming, task)
        else {
            return;
        };
        let key = format!("{kind}-{}", self.node(node).start);
        self.emit(key, spacing, content);
    }

    fn emit(&mut self, key: String, spacing: FormatSpacing, content: FormatContent) {
        let containers = self
            .stack
            .iter_mut()
            .map(|(container, drawn)| {
                let mut container = container.clone();
                container.first = !*drawn;
                *drawn = true;
                container
            })
            .collect();
        let spacing = if self.out.is_empty() {
            FormatSpacing::None
        } else {
            spacing
        };
        self.out.push(FormatBlock {
            key,
            containers,
            spacing,
            direction: direction::of(&content),
            content,
        });
    }
}

fn is_framed(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::Code(_)
            | Kind::Table(_)
            | Kind::Quote
            | Kind::Callout(_)
            | Kind::Insight
            | Kind::Math(_)
            | Kind::Html(_)
    )
}

/// A list's widest marker in characters: one for bullets and tasks, at least `00.` for numbers.
fn marker_width(data: &ListData, items: usize) -> u32 {
    if data.bullet.is_some() {
        return 1;
    }
    let last = data.start.saturating_add(items.saturating_sub(1) as u64);
    let digits = last.checked_ilog10().unwrap_or(0) + 1;
    digits.max(2) + 1
}

fn offset(start: usize) -> u32 {
    u32::try_from(start).unwrap_or(u32::MAX)
}
