//! How a tool call reads in the work fold (`broski-render`) and what a form shows (`broski-contract`),
//! decided once for both apps. Pure functions of their input, callable from any thread.

use std::collections::HashMap;

use broski_contract::{FormFieldSpec, FormValue};
use broski_render::{
    ArgumentValue, FoldCount, FoldTool, FoldVerb, FormatSpan, LogLine, LogText, MatchRow,
    MatchSegment, TokenKind, ToolArgument, ToolBody, ToolFacts, ToolKind, ToolLook,
};

/// The kind, one line, command and files of a tool call, for its row in the work fold.
#[uniffi::export]
pub fn tool_look(facts: ToolFacts) -> ToolLook {
    broski_render::tool_look(&facts)
}

/// How a call's result reads when its tool gave no display of its own: markdown, a file's numbered
/// lines, search rows, JSON or a log (`output` is the result's text).
#[uniffi::export]
pub fn tool_body(facts: ToolFacts, output: String) -> ToolBody {
    broski_render::tool_body(&facts, &output)
}

/// Text that is not markdown (a log, an error, a command's output): at most `max_lines` lines from
/// the end `keep` names, its links found.
#[uniffi::export]
pub fn format_log(text: String, max_lines: u32, keep: broski_render::ClipEnd) -> LogText {
    broski_render::format_log(&text, max_lines, keep)
}

/// A call's arguments as a property list, for the work fold and the permission card.
#[uniffi::export]
pub fn tool_arguments(facts: ToolFacts) -> Vec<ToolArgument> {
    broski_render::tool_arguments(&facts)
}

/// The phrases of a fold's sentence ("Edited 1 file"), from the stretch's own calls (not a
/// subagent's): at most two verbs, the rest as `used`.
#[uniffi::export]
pub fn fold_counts(tools: Vec<FoldTool>) -> Vec<FoldCount> {
    broski_render::fold_counts(&tools)
}

/// Whether a form field is shown, and so answered, given the answers so far.
#[uniffi::export]
pub fn form_field_shown(field: FormFieldSpec, values: HashMap<String, FormValue>) -> bool {
    broski_contract::form_field_shown(&field, &values)
}

/// The value a form field starts with, when it has a default.
#[uniffi::export]
pub fn form_field_default(field: FormFieldSpec) -> Option<FormValue> {
    broski_contract::form_field_default(&field)
}

#[uniffi::remote(Enum)]
pub enum ToolKind {
    Read,
    Edit,
    Command,
    Search,
    Web,
    Agent,
    Other,
}

#[uniffi::remote(Record)]
pub struct ToolFacts {
    pub name: String,
    pub title: Option<String>,
    pub input: Option<broski_contract::JsonValue>,
    pub has_child_session: bool,
    pub changed_paths: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct ToolLook {
    pub kind: ToolKind,
    pub label: String,
    pub verb: String,
    pub command: Option<String>,
    pub paths: Vec<String>,
}

#[uniffi::remote(Enum)]
pub enum FoldVerb {
    Edited,
    Ran,
    Read,
    Searched,
    Fetched,
    Delegated,
    Used,
}

#[uniffi::remote(Record)]
pub struct FoldCount {
    pub verb: FoldVerb,
    pub count: u32,
    pub phrase: String,
}

#[uniffi::remote(Record)]
pub struct FoldTool {
    pub id: String,
    pub kind: ToolKind,
    pub paths: Vec<String>,
}

#[uniffi::remote(Enum)]
pub enum ToolBody {
    Empty,
    Markdown {
        text: String,
    },
    FileText {
        path: String,
        language: Option<String>,
        first_line: u32,
        text: String,
    },
    Matches {
        rows: Vec<MatchRow>,
        hidden_rows: u32,
    },
    Json {
        lines: Vec<broski_render::CodeLine>,
    },
    Log {
        lines: Vec<LogLine>,
        hidden_lines: u32,
    },
}

#[uniffi::remote(Record)]
pub struct MatchRow {
    pub path: String,
    pub line: Option<u32>,
    pub segments: Vec<MatchSegment>,
}

#[uniffi::remote(Record)]
pub struct MatchSegment {
    pub text: String,
    pub matched: bool,
}

#[uniffi::remote(Record)]
pub struct LogText {
    pub lines: Vec<LogLine>,
    pub hidden_lines: u32,
}

#[uniffi::remote(Record)]
pub struct LogLine {
    pub spans: Vec<FormatSpan>,
}

#[uniffi::remote(Record)]
pub struct ToolArgument {
    pub key: String,
    pub depth: u32,
    pub value: ArgumentValue,
}

#[uniffi::remote(Enum)]
pub enum ArgumentValue {
    Inline {
        text: String,
        kind: TokenKind,
    },
    Text {
        text: String,
        hidden_lines: u32,
    },
    Code {
        text: String,
        language: Option<String>,
        hidden_lines: u32,
    },
    Markdown {
        text: String,
    },
    Nested {
        count: u32,
        list: bool,
    },
    More {
        count: u32,
    },
}
