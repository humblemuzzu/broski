//! Broski's formatter (`broski-render`'s `format`): the agent's markdown as flat keyed blocks, its
//! exports (plain text, a table as Markdown, CSV, TSV or HTML, JSON as coloured lines), the code
//! block's language label, and the gallery's samples. Pure functions callable without a `Phone`
//! from any thread.

use broski_render::{
    CalloutKind, CodeLine, ColumnAlign, ContainerKind, FormatBlock, FormatCode, FormatContainer,
    FormatContent, FormatLink, FormatSample, FormatSpacing, FormatSpan, FormatTable, LinkKind,
    ListMarker, TableCell, TableColumn, TableShape, TextDirection,
};

/// `text` as blocks to lay out in order; each block's `key` stays the same while text is appended,
/// so a streaming message redraws only its last block. `streaming` while more text is coming.
#[uniffi::export]
pub fn format_markdown(text: String, streaming: bool) -> Vec<FormatBlock> {
    broski_render::format_markdown(&text, streaming)
}

/// The person's own message or a notice: inline styles and fenced code, the rest as typed.
#[uniffi::export]
pub fn format_message(text: String) -> Vec<FormatBlock> {
    broski_render::format_message(&text)
}

/// `text` with its markup gone, for Copy as plain text.
#[uniffi::export]
pub fn format_plain_text(text: String) -> String {
    broski_render::format_plain_text(&text)
}

/// A table as GitHub Markdown.
#[uniffi::export]
pub fn table_markdown(table: FormatTable) -> String {
    broski_render::table_markdown(&table)
}

/// A table as comma-separated values.
#[uniffi::export]
pub fn table_csv(table: FormatTable) -> String {
    broski_render::table_csv(&table)
}

/// A table as tab-separated rows, the plain half of its copy.
#[uniffi::export]
pub fn table_tsv(table: FormatTable) -> String {
    broski_render::table_tsv(&table)
}

/// A table as HTML, the rich half of its copy.
#[uniffi::export]
pub fn table_html(table: FormatTable) -> String {
    broski_render::table_html(&table)
}

/// `text` pretty-printed as coloured lines when it is a JSON object or array.
#[uniffi::export]
pub fn format_json(text: String) -> Option<Vec<CodeLine>> {
    broski_render::format_json(&text)
}

/// What a code block's header calls a fence's language (`ts` → `TypeScript`).
#[uniffi::export]
pub fn language_label(label: String) -> String {
    broski_render::language_label(&label)
}

/// The formatting gallery's samples: agent-shaped text with every case the formatter must draw.
#[uniffi::export]
pub fn format_samples() -> Vec<FormatSample> {
    broski_render::format_samples()
}

#[uniffi::remote(Record)]
pub struct FormatBlock {
    pub key: String,
    pub containers: Vec<FormatContainer>,
    pub spacing: FormatSpacing,
    pub direction: TextDirection,
    pub content: FormatContent,
}

#[uniffi::remote(Record)]
pub struct FormatContainer {
    pub id: u32,
    pub kind: ContainerKind,
    pub first: bool,
}

#[uniffi::remote(Enum)]
pub enum ContainerKind {
    Quote,
    Callout {
        kind: CalloutKind,
    },
    Item {
        list: u32,
        marker: ListMarker,
        depth: u32,
        width: u32,
    },
    Footnote {
        label: String,
    },
}

#[uniffi::remote(Enum)]
pub enum CalloutKind {
    Note,
    Tip,
    Important,
    Warning,
    Caution,
    Insight,
}

#[uniffi::remote(Enum)]
pub enum ListMarker {
    Bullet,
    Number { value: u64, paren: bool },
    Task { checked: bool },
}

#[uniffi::remote(Enum)]
pub enum FormatSpacing {
    None,
    Tight,
    Loose,
    AfterGroup,
    AfterHeading,
    Paragraph,
    Section,
}

#[uniffi::remote(Enum)]
pub enum TextDirection {
    LeftToRight,
    RightToLeft,
}

#[uniffi::remote(Enum)]
pub enum FormatContent {
    Paragraph { spans: Vec<FormatSpan> },
    Heading { level: u8, spans: Vec<FormatSpan> },
    Code { code: FormatCode },
    Table { table: FormatTable },
    Math { tex: String },
    Html { text: String },
    Rule,
}

#[uniffi::remote(Record)]
pub struct FormatCode {
    pub language: Option<String>,
    pub file: Option<String>,
    pub text: String,
    pub closed: bool,
    pub prose: bool,
}

#[uniffi::remote(Record)]
pub struct FormatSpan {
    pub text: String,
    pub strong: bool,
    pub emphasis: bool,
    pub strike: bool,
    pub code: bool,
    pub math: bool,
    pub html: bool,
    pub link: Option<FormatLink>,
}

#[uniffi::remote(Record)]
pub struct FormatLink {
    pub kind: LinkKind,
    pub target: String,
    pub title: Option<String>,
    pub image: bool,
    pub bare: bool,
}

#[uniffi::remote(Enum)]
pub enum LinkKind {
    Web,
    Mail,
    File {
        line: Option<u32>,
        column: Option<u32>,
    },
    Footnote,
    Inert,
}

#[uniffi::remote(Record)]
pub struct FormatTable {
    pub columns: Vec<TableColumn>,
    pub header: Vec<TableCell>,
    pub rows: Vec<Vec<TableCell>>,
    pub shape: TableShape,
}

#[uniffi::remote(Record)]
pub struct TableCell {
    pub spans: Vec<FormatSpan>,
}

#[uniffi::remote(Record)]
pub struct TableColumn {
    pub align: ColumnAlign,
    pub numeric: bool,
    pub longest_cell: u32,
    pub longest_word: u32,
    pub short: bool,
}

#[uniffi::remote(Enum)]
pub enum ColumnAlign {
    Auto,
    Start,
    Center,
    End,
}

#[uniffi::remote(Enum)]
pub enum TableShape {
    Grid,
    KeyValue,
}

#[uniffi::remote(Record)]
pub struct FormatSample {
    pub title: String,
    pub text: String,
    pub arriving: bool,
}
