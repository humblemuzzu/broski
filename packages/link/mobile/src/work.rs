//! How a tool call reads in the work fold (`broski-render`) and what a form shows (`broski-contract`),
//! decided once for both apps. Pure functions of their input, callable from any thread.

use std::collections::HashMap;

use broski_contract::{FormFieldSpec, FormValue};
use broski_render::{FoldCount, FoldTool, FoldVerb, ToolFacts, ToolKind, ToolLook};

/// The kind, one line, command and files of a tool call, for its row in the work fold.
#[uniffi::export]
pub fn tool_look(facts: ToolFacts) -> ToolLook {
    broski_render::tool_look(&facts)
}

/// The verbs and counts of a fold's sentence, from the stretch's own calls (not a subagent's):
/// at most two verbs, the rest as `used`.
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
}

#[uniffi::remote(Record)]
pub struct FoldTool {
    pub id: String,
    pub kind: ToolKind,
    pub paths: Vec<String>,
}
