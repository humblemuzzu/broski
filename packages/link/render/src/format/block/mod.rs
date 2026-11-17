//! The block structure, one line at a time, after CommonMark's own algorithm (§ "Appendix: A
//! parsing strategy"): each line first continues the open containers it can, then may open new
//! ones, then lands in a leaf. GitHub's tables, alerts and footnotes, display math and Claude
//! Code's insight block are block starts like the rest.

mod cursor;
mod html;
mod leaf;
mod list_item;
mod starts;
mod table;
pub(crate) mod tree;

use cursor::{is_space_or_tab, lines, Cursor, CODE_INDENT};
pub(crate) use leaf::RefMap;
use tree::{Kind, Node};

/// Containers nested deeper than this are read as text: no line can make the parser walk an
/// unbounded stack.
pub(crate) const MAX_DEPTH: usize = 32;

pub(crate) struct Tree {
    pub nodes: Vec<Node>,
    pub refs: RefMap,
}

/// `streaming` while more text is coming: display math still open is then math, not text.
pub(crate) fn parse(text: &str, streaming: bool) -> Tree {
    let mut parser = Parser {
        nodes: vec![Node::new(Kind::Document, 0, 0, 0)],
        tip: 0,
        old_tip: 0,
        last_matched: 0,
        all_closed: true,
        line_number: 0,
        line_start: 0,
        refs: RefMap::default(),
        streaming,
        last_closers: last_math_closers(text),
    };
    for (start, line) in lines(text) {
        parser.line_start = start;
        parser.line_number += 1;
        let mut cursor = Cursor::new(line);
        parser.incorporate(&mut cursor);
    }
    while parser.tip != 0 {
        parser.finalize(parser.tip, parser.line_number);
    }
    parser.finalize(0, parser.line_number);
    Tree {
        nodes: parser.nodes,
        refs: parser.refs,
    }
}

pub(super) enum Continued {
    Matched,
    Failed,
    /// The line was the block's end (a closing fence) and is used up.
    Done,
}

pub(super) enum Started {
    No,
    Container,
    Leaf,
}

pub(super) struct Parser {
    pub nodes: Vec<Node>,
    pub tip: usize,
    pub old_tip: usize,
    pub last_matched: usize,
    pub all_closed: bool,
    pub line_number: usize,
    pub line_start: usize,
    pub refs: RefMap,
    streaming: bool,
    /// Where the last line ending in `$$` and the last ending in `\]` start.
    last_closers: [Option<usize>; 2],
}

/// The start of the last line ending in each display-math closer, found once so that opening math
/// can ask whether it will close without scanning ahead every time.
fn last_math_closers(text: &str) -> [Option<usize>; 2] {
    let mut found = [None, None];
    for (start, line) in lines(text) {
        let line = line.trim_end();
        if line.ends_with("$$") {
            found[0] = Some(start);
        }
        if line.ends_with("\\]") {
            found[1] = Some(start);
        }
    }
    found
}

impl Parser {
    /// Whether display math opened on this line can still be closed: by a later line, or by text
    /// still to come.
    pub fn math_may_close(&self, closer: &str) -> bool {
        let last = self.last_closers[usize::from(closer != "$$")];
        self.streaming || last.is_some_and(|start| start > self.line_start)
    }

    fn incorporate(&mut self, cursor: &mut Cursor) {
        self.old_tip = self.tip;
        let Some(mut container) = self.continue_open(cursor) else {
            return;
        };
        self.all_closed = container == self.old_tip;
        self.last_matched = container;
        let kind = &self.nodes[container].kind;
        let mut matched_leaf = kind.takes_lines_whole();
        while !matched_leaf {
            cursor.find_next_nonspace();
            if !cursor.indented && !maybe_special(cursor.rest()) {
                cursor.advance_next_nonspace();
                break;
            }
            match self.try_starts(cursor, container) {
                Started::No => {
                    cursor.advance_next_nonspace();
                    break;
                }
                Started::Container => container = self.tip,
                Started::Leaf => {
                    container = self.tip;
                    matched_leaf = true;
                }
            }
        }
        self.place_line(cursor, container);
    }

    /// Walks the open containers this line continues; `None` when the line is used up.
    fn continue_open(&mut self, cursor: &mut Cursor) -> Option<usize> {
        let mut container = 0;
        while let Some(&last) = self.nodes[container].children.last() {
            if !self.nodes[last].open {
                break;
            }
            container = last;
            cursor.find_next_nonspace();
            match self.continue_block(cursor, container) {
                Continued::Matched => {}
                Continued::Failed => return Some(self.nodes[container].parent),
                Continued::Done => return None,
            }
        }
        Some(container)
    }

    fn place_line(&mut self, cursor: &mut Cursor, container: usize) {
        let tip_is_paragraph = matches!(self.nodes[self.tip].kind, Kind::Paragraph);
        if !self.all_closed && !cursor.blank && tip_is_paragraph {
            self.add_line(cursor);
            return;
        }
        self.close_unmatched();
        let kind = &self.nodes[container].kind;
        if kind.accepts_lines() {
            self.add_line(cursor);
            if let Kind::Html(start) = self.nodes[container].kind {
                if html::ends(start, &cursor.line[cursor.offset..]) {
                    self.finalize(container, self.line_number);
                }
            }
        } else if cursor.offset < cursor.line.len() && !cursor.blank {
            let start = self.line_start + cursor.offset;
            self.add_child(Kind::Paragraph, start);
            cursor.advance_next_nonspace();
            self.add_line(cursor);
        }
    }

    fn continue_block(&mut self, cursor: &mut Cursor, node: usize) -> Continued {
        match &self.nodes[node].kind {
            Kind::Document | Kind::List(_) => Continued::Matched,
            Kind::Quote | Kind::Callout(_) => continue_quote(cursor),
            Kind::Insight => self.continue_insight(cursor, node),
            Kind::Item(data) => {
                let needed = data.marker_offset + data.padding;
                if cursor.blank {
                    if self.nodes[node].children.is_empty() {
                        return Continued::Failed;
                    }
                    cursor.advance_next_nonspace();
                } else if cursor.indent >= needed {
                    cursor.advance(needed, true);
                } else {
                    return Continued::Failed;
                }
                Continued::Matched
            }
            Kind::Footnote(_) => {
                if cursor.blank {
                    cursor.advance_next_nonspace();
                } else if cursor.indent >= CODE_INDENT {
                    cursor.advance(CODE_INDENT, true);
                } else {
                    return Continued::Failed;
                }
                Continued::Matched
            }
            Kind::Code(_) => self.continue_code(cursor, node),
            Kind::Math(_) => self.continue_math(cursor, node),
            Kind::Html(start) if cursor.blank && (*start == 6 || *start == 7) => Continued::Failed,
            Kind::Html(_) => Continued::Matched,
            Kind::Paragraph | Kind::Table(_) if cursor.blank => Continued::Failed,
            Kind::Paragraph | Kind::Table(_) => Continued::Matched,
            Kind::Heading(_) | Kind::Rule | Kind::Removed => Continued::Failed,
        }
    }

    fn continue_insight(&mut self, cursor: &mut Cursor, node: usize) -> Continued {
        if !cursor.indented && starts::closes_insight(cursor.rest()) {
            self.finalize(node, self.line_number);
            return Continued::Done;
        }
        Continued::Matched
    }

    fn continue_code(&mut self, cursor: &mut Cursor, node: usize) -> Continued {
        let Kind::Code(code) = &self.nodes[node].kind else {
            return Continued::Failed;
        };
        let Some((marker, length, indent)) = code.fence else {
            if cursor.indent >= CODE_INDENT {
                cursor.advance(CODE_INDENT, true);
            } else if cursor.blank {
                cursor.advance_next_nonspace();
            } else {
                return Continued::Failed;
            }
            return Continued::Matched;
        };
        if cursor.indent <= 3 && starts::closes_fence(cursor.rest(), marker, length) {
            if let Kind::Code(code) = &mut self.nodes[node].kind {
                code.closed = true;
            }
            self.finalize(node, self.line_number);
            return Continued::Done;
        }
        let mut left = indent;
        while left > 0 && is_space_or_tab(cursor.peek_at(cursor.offset)) {
            cursor.advance(1, true);
            left -= 1;
        }
        Continued::Matched
    }

    fn continue_math(&mut self, cursor: &mut Cursor, node: usize) -> Continued {
        let Kind::Math(math) = &self.nodes[node].kind else {
            return Continued::Failed;
        };
        if math.closed {
            return Continued::Failed;
        }
        let closer = math.closer;
        let line = cursor.line[cursor.offset..].trim_end();
        let Some(before) = line.strip_suffix(closer) else {
            return Continued::Matched;
        };
        let before = before.trim();
        if !before.is_empty() {
            self.nodes[node].text.push_str(before);
            self.nodes[node].text.push('\n');
        }
        if let Kind::Math(math) = &mut self.nodes[node].kind {
            math.closed = true;
        }
        self.finalize(node, self.line_number);
        Continued::Done
    }

    fn add_line(&mut self, cursor: &Cursor) {
        let tip = self.tip;
        let start = self.line_start + cursor.offset;
        let node = &mut self.nodes[tip];
        if let Kind::Table(table) = &mut node.kind {
            let row = &cursor.line[cursor.offset..];
            if !row.is_empty() {
                table.rows.push(row.to_owned());
            }
            return;
        }
        node.line_starts.push(start);
        node.text.push_str(&cursor.remainder());
        node.text.push('\n');
    }

    pub fn add_child(&mut self, kind: Kind, start: usize) -> usize {
        while !self.can_contain(self.tip, &kind) {
            self.finalize(self.tip, self.line_number - 1);
        }
        let id = self.nodes.len();
        self.nodes
            .push(Node::new(kind, self.tip, start, self.line_number));
        self.nodes[self.tip].children.push(id);
        self.tip = id;
        id
    }

    fn can_contain(&self, parent: usize, kind: &Kind) -> bool {
        let parent = &self.nodes[parent].kind;
        if matches!(kind, Kind::Item(_)) {
            return parent.can_contain_item();
        }
        parent.is_container() && !parent.can_contain_item()
    }

    pub fn close_unmatched(&mut self) {
        if self.all_closed {
            return;
        }
        while self.old_tip != self.last_matched {
            let parent = self.nodes[self.old_tip].parent;
            self.finalize(self.old_tip, self.line_number - 1);
            self.old_tip = parent;
        }
        self.all_closed = true;
    }

    pub fn finalize(&mut self, node: usize, line: usize) {
        self.nodes[node].open = false;
        self.nodes[node].end_line = line;
        leaf::finalize(self, node);
        self.tip = self.nodes[node].parent;
    }

    /// Containers open around the tip, for the nesting bound.
    pub fn depth(&self) -> usize {
        let mut depth = 0;
        let mut node = self.tip;
        while node != 0 {
            depth += usize::from(self.nodes[node].kind.is_container());
            node = self.nodes[node].parent;
        }
        depth
    }
}

fn continue_quote(cursor: &mut Cursor) -> Continued {
    if cursor.indented || cursor.peek_at(cursor.next_nonspace) != Some(b'>') {
        return Continued::Failed;
    }
    cursor.advance_next_nonspace();
    cursor.advance(1, false);
    if is_space_or_tab(cursor.peek_at(cursor.offset)) {
        cursor.advance(1, true);
    }
    Continued::Matched
}

/// Whether a line could open a block at all: most lines are plain text and skip the starts.
fn maybe_special(rest: &str) -> bool {
    matches!(
        rest.as_bytes().first(),
        Some(
            b'#' | b'`'
                | b'~'
                | b'*'
                | b'+'
                | b'_'
                | b'='
                | b'<'
                | b'>'
                | b'-'
                | b'|'
                | b':'
                | b'$'
                | b'\\'
                | b'['
                | b'0'..=b'9'
        )
    ) || rest.starts_with('★')
}

/// A table row's cells as text for the inline parser.
pub(crate) fn table_cells(row: &str) -> Vec<String> {
    table::cells(row)
        .into_iter()
        .map(table::cell_text)
        .collect()
}
