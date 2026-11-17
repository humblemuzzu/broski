//! What the formatter hands the apps: flat blocks, each with the containers around it, the space
//! before it, its direction and its content.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatBlock {
    /// The block's identity while the text grows: its kind and the byte offset its source starts
    /// at (`p-0`, `code-34`).
    pub key: String,
    /// The quotes, callouts, list items and footnotes around the block, outermost first.
    pub containers: Vec<FormatContainer>,
    /// The space between this block and the one before it.
    pub spacing: FormatSpacing,
    pub direction: TextDirection,
    pub content: FormatContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatContainer {
    /// Where the container's marker is in the source: neighbouring blocks with the same `id` sit in
    /// one container, so a quote's bar or a callout's card runs on unbroken across them.
    pub id: u32,
    pub kind: ContainerKind,
    /// This block opens the container: it draws the list marker or the callout's title.
    pub first: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContainerKind {
    Quote,
    Callout {
        kind: CalloutKind,
    },
    Item {
        /// Where the item's list starts; items of one list share it.
        list: u32,
        marker: ListMarker,
        /// Lists around this one: 0 for a list at the top.
        depth: u32,
        /// The widest marker of the list in characters (`10.` is 3), at least `00.` for numbers,
        /// so a gutter that wide keeps every item's text aligned.
        width: u32,
    },
    Footnote {
        label: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CalloutKind {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
    /// Claude Code's `★ Insight ─────` block.
    Insight,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListMarker {
    /// Drawn by depth: • ◦ ▪.
    Bullet,
    /// The item's number as the list counts it; `paren` for `1)` rather than `1.`.
    Number {
        value: u64,
        paren: bool,
    },
    Task {
        checked: bool,
    },
}

/// The space before a block, by what it follows; each app maps steps to points from one table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FormatSpacing {
    /// The text's first block.
    None,
    /// Items of a tight list, and blocks of one item with no blank line between them.
    Tight,
    /// Items of a list with blank lines between them.
    Loose,
    /// The block under a heading.
    AfterHeading,
    Paragraph,
    /// Before a heading.
    Section,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TextDirection {
    LeftToRight,
    RightToLeft,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatContent {
    /// Text whose line breaks are kept as written. An empty one stands for an empty list item or
    /// quote, so its marker still shows.
    Paragraph {
        spans: Vec<FormatSpan>,
    },
    Heading {
        level: u8,
        spans: Vec<FormatSpan>,
    },
    Code {
        code: FormatCode,
    },
    Table {
        table: FormatTable,
    },
    /// Display math (`$$ … $$`, `\[ … \]`), as TeX.
    Math {
        tex: String,
    },
    /// An HTML block, shown as the text it is: nothing an agent writes is run as HTML.
    Html {
        text: String,
    },
    Rule,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatCode {
    /// The fence's first word as written (`ts`): the label to normalise and the language to
    /// hand `highlight`.
    pub language: Option<String>,
    /// A file name after the language (```` ```swift Sources/App.swift ````).
    pub file: Option<String>,
    pub text: String,
    /// False while its closing fence has not arrived, which a streaming message's last block often
    /// is.
    pub closed: bool,
    /// Text rather than code (no language, `text`, `markdown`, `log`): it wraps instead of
    /// scrolling sideways.
    pub prose: bool,
}

/// Text in one style. Neighbouring spans always differ in style or link.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FormatSpan {
    /// What to draw. For a long bare URL this is a shortened form; its link holds the whole.
    pub text: String,
    pub strong: bool,
    pub emphasis: bool,
    pub strike: bool,
    pub code: bool,
    /// Inline TeX (`$…$`, `\(…\)`).
    pub math: bool,
    /// Inline HTML, shown as written.
    pub html: bool,
    pub link: Option<FormatLink>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatLink {
    pub kind: LinkKind,
    /// The URL, the address with its `mailto:`, the path without its line, or the footnote label.
    pub target: String,
    pub title: Option<String>,
    /// An image (`![alt](url)`): the span's text is its alt text. Images are never loaded.
    pub image: bool,
    /// The text itself was linked (a bare URL, an address or a path) rather than written as a
    /// link.
    pub bare: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkKind {
    /// `http` or `https`: opens in the in-app browser.
    Web,
    Mail,
    /// A path in the session's folder, with the line and column it names.
    File {
        line: Option<u32>,
        column: Option<u32>,
    },
    Footnote,
    /// Any other scheme (`tel:`, `javascript:`, `file:`, `broski:`) or an anchor: drawn as text,
    /// never opened.
    Inert,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatTable {
    pub columns: Vec<TableColumn>,
    pub header: Vec<TableCell>,
    /// Every row has one cell per column: short rows are filled with empty cells, long ones cut.
    pub rows: Vec<Vec<TableCell>>,
    pub shape: TableShape,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCell {
    pub spans: Vec<FormatSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableColumn {
    pub align: ColumnAlign,
    /// Every non-empty body cell is a number, maybe with a unit (`1.2 GB`, `~90 KB`, `12%`).
    pub numeric: bool,
    /// Characters of the longest cell, header included.
    pub longest_cell: u32,
    /// Characters of the longest word: the column's narrowest width without breaking a word.
    pub longest_word: u32,
    /// Every cell, header included, is short enough never to wrap.
    pub short: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ColumnAlign {
    /// No alignment given: numbers go to the end, the rest to the start.
    Auto,
    Start,
    Center,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TableShape {
    Grid,
    /// Two columns of short labels and their values: always fits the width, never scrolls.
    KeyValue,
}
