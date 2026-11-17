//! The block tree the line pass builds before it is flattened: an arena of nodes, the document
//! first.

use crate::format::model::{CalloutKind, ColumnAlign};

pub(crate) struct Node {
    pub kind: Kind,
    pub parent: usize,
    pub children: Vec<usize>,
    pub open: bool,
    /// The byte offset the block's source starts at: its key, and a container's id.
    pub start: usize,
    pub start_line: usize,
    pub end_line: usize,
    /// A leaf's lines, each ending in `\n`.
    pub text: String,
    /// A paragraph's lines' byte offsets, one per line of `text`.
    pub line_starts: Vec<usize>,
}

pub(crate) enum Kind {
    Document,
    Quote,
    Callout(CalloutKind),
    /// Claude Code's `★ Insight` block, open until its closing rule.
    Insight,
    List(ListData),
    Item(ListData),
    Footnote(String),
    Paragraph,
    Heading(u8),
    Code(CodeData),
    /// The HTML block's start condition, 1 to 7 (CommonMark §4.6).
    Html(u8),
    Rule,
    Table(TableData),
    Math(MathData),
    /// A paragraph that held only link reference definitions.
    Removed,
}

#[derive(Clone, Copy)]
pub(crate) struct ListData {
    /// `-`, `+` or `*`; none for an ordered list.
    pub bullet: Option<u8>,
    pub start: u64,
    /// `.` or `)`.
    pub delimiter: u8,
    pub marker_offset: usize,
    pub padding: usize,
}

impl ListData {
    pub fn same_list(&self, other: &ListData) -> bool {
        self.bullet == other.bullet && (self.bullet.is_some() || self.delimiter == other.delimiter)
    }
}

pub(crate) struct CodeData {
    /// The fence's character, length and indentation; none for indented code.
    pub fence: Option<(u8, usize, usize)>,
    pub info: String,
    pub closed: bool,
}

pub(crate) struct TableData {
    pub aligns: Vec<ColumnAlign>,
    pub header: String,
    pub rows: Vec<String>,
}

pub(crate) struct MathData {
    pub closer: &'static str,
    pub closed: bool,
}

impl Kind {
    pub fn is_container(&self) -> bool {
        matches!(
            self,
            Kind::Document
                | Kind::Quote
                | Kind::Callout(_)
                | Kind::Insight
                | Kind::List(_)
                | Kind::Item(_)
                | Kind::Footnote(_)
        )
    }

    pub fn can_contain_item(&self) -> bool {
        matches!(self, Kind::List(_))
    }

    /// Leaves whose lines are taken as they come, with no block starts looked for inside.
    pub fn takes_lines_whole(&self) -> bool {
        matches!(self, Kind::Code(_) | Kind::Html(_) | Kind::Math(_))
    }

    pub fn accepts_lines(&self) -> bool {
        matches!(
            self,
            Kind::Paragraph | Kind::Code(_) | Kind::Html(_) | Kind::Math(_) | Kind::Table(_)
        )
    }
}

impl Node {
    pub fn new(kind: Kind, parent: usize, start: usize, line: usize) -> Self {
        Node {
            kind,
            parent,
            children: Vec::new(),
            open: true,
            start,
            start_line: line,
            end_line: line,
            text: String::new(),
            line_starts: Vec::new(),
        }
    }
}
