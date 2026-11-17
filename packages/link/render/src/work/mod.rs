//! How a tool call reads in the work fold, decided once for both apps: what kind of work it was,
//! the one line its row shows, the command it ran, and what the fold's sentence counts. The apps
//! add the icon, the plural words of the sentence and the time.

mod arguments;
mod body;
#[cfg(test)]
mod body_tests;
mod fold;
#[cfg(test)]
mod tests;

pub use arguments::{tool_arguments, ArgumentValue, ToolArgument};
pub use body::{
    format_log, tool_body, LogLine, LogText, MatchRow, MatchSegment, ToolBody, TOOL_LOG_LINES,
};
pub use fold::{fold_counts, FoldCount, FoldTool, FoldVerb};

use broski_contract::JsonValue;

/// What a tool did, read from the call's name and what it produced. Both agents name their tools
/// plainly (`bash`/`Bash`, `read`/`Read`); anything else, an MCP tool included, is `Other`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Read,
    Edit,
    Command,
    Search,
    Web,
    Agent,
    Other,
}

/// A tool call as either app has it: from its call item, or the running tool while it runs.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolFacts {
    pub name: String,
    /// The backend's own words for the call.
    pub title: Option<String>,
    pub input: Option<JsonValue>,
    /// The call ran a subagent in a session of its own.
    pub has_child_session: bool,
    /// The paths of the files the call changed, once it has a result.
    pub changed_paths: Vec<String>,
}

/// What the work fold shows of a call.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolLook {
    pub kind: ToolKind,
    /// The call's one line while its row is closed: the backend's title, else what it acted on.
    pub label: String,
    /// What the row says instead while open, when its detail shows the command or the arguments
    /// the label was made from: "Ran command", "Read file".
    pub verb: String,
    /// A command tool's command, exactly as the agent wrote it.
    pub command: Option<String>,
    /// The files the call changed, else the one its input names; a file counts once in the fold
    /// however often it is read or edited.
    pub paths: Vec<String>,
}

const READ: [&str; 5] = ["read", "view", "cat", "notebookread", "read_file"];
const EDIT: [&str; 9] = [
    "edit",
    "write",
    "multiedit",
    "notebookedit",
    "patch",
    "apply_patch",
    "str_replace",
    "create",
    "write_file",
];
const COMMAND: [&str; 8] = [
    "bash",
    "shell",
    "exec",
    "command",
    "run",
    "terminal",
    "bashoutput",
    "killshell",
];
const SEARCH: [&str; 7] = ["grep", "glob", "find", "ls", "search", "list", "toolsearch"];
const WEB: [&str; 6] = [
    "webfetch",
    "websearch",
    "fetch",
    "web_fetch",
    "web_search",
    "browse",
];
const AGENT: [&str; 3] = ["task", "agent", "subagent"];

const PATH_KEYS: [&str; 5] = ["file_path", "path", "filePath", "notebook_path", "file"];
const COMMAND_KEYS: [&str; 3] = ["command", "cmd", "script"];
const PATTERN_KEYS: [&str; 3] = ["pattern", "query", "glob"];
const WEB_KEYS: [&str; 2] = ["url", "query"];
const AGENT_KEYS: [&str; 2] = ["description", "prompt"];
const OTHER_KEYS: [&str; 4] = ["path", "file_path", "query", "description"];

/// The kind of a call. A call that ran a subagent is an agent, and one that changed files an edit,
/// whatever it is named.
pub fn tool_kind(facts: &ToolFacts) -> ToolKind {
    let name = facts.name.to_lowercase();
    let named = |names: &[&str]| names.contains(&name.as_str());
    if facts.has_child_session || named(&AGENT) {
        ToolKind::Agent
    } else if !facts.changed_paths.is_empty() || named(&EDIT) {
        ToolKind::Edit
    } else if named(&COMMAND) {
        ToolKind::Command
    } else if named(&READ) {
        ToolKind::Read
    } else if named(&SEARCH) {
        ToolKind::Search
    } else if named(&WEB) {
        ToolKind::Web
    } else {
        ToolKind::Other
    }
}

/// How the work fold shows `facts`.
pub fn tool_look(facts: &ToolFacts) -> ToolLook {
    let kind = tool_kind(facts);
    let input = facts.input.as_ref();
    let command = (kind == ToolKind::Command)
        .then(|| text_of(input, &COMMAND_KEYS))
        .flatten()
        .map(str::to_owned);
    let paths = if facts.changed_paths.is_empty() {
        text_of(input, &PATH_KEYS)
            .map(|path| vec![path.to_owned()])
            .unwrap_or_default()
    } else {
        facts.changed_paths.clone()
    };
    let label = match facts
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
    {
        Some(title) => first_line(title),
        None => label(facts, kind, command.as_deref(), &paths),
    };
    ToolLook {
        kind,
        label,
        verb: verb(kind, &facts.name),
        command,
        paths,
    }
}

fn label(facts: &ToolFacts, kind: ToolKind, command: Option<&str>, paths: &[String]) -> String {
    let input = facts.input.as_ref();
    let name = facts.name.as_str();
    let line = |keys: &[&str]| text_of(input, keys).map(first_line);
    let target = paths.first().map(|path| base_name(path));
    match kind {
        ToolKind::Command => command.map(first_line),
        ToolKind::Read => target.map(|file| format!("Read {file}")),
        ToolKind::Edit => target.map(|file| format!("Edited {file}")),
        ToolKind::Search => line(&PATTERN_KEYS)
            .or_else(|| line(&PATH_KEYS))
            .map(|what| format!("Searched {what}")),
        ToolKind::Web => line(&WEB_KEYS),
        ToolKind::Agent => Some(line(&AGENT_KEYS).unwrap_or_else(|| "Subagent".to_owned())),
        ToolKind::Other => line(&OTHER_KEYS).map(|what| format!("{name} {what}")),
    }
    .unwrap_or_else(|| name.to_owned())
}

fn verb(kind: ToolKind, name: &str) -> String {
    match kind {
        ToolKind::Command => "Ran command",
        ToolKind::Read => "Read file",
        ToolKind::Edit => "Edited file",
        ToolKind::Search => "Searched",
        ToolKind::Web => "Fetched",
        ToolKind::Agent => "Subagent",
        ToolKind::Other => name,
    }
    .to_owned()
}

/// The first of `keys` that holds text in an object input.
fn text_of<'a>(input: Option<&'a JsonValue>, keys: &[&str]) -> Option<&'a str> {
    let JsonValue::Object(members) = input? else {
        return None;
    };
    keys.iter().find_map(|key| {
        members.iter().find_map(|member| match &member.value {
            JsonValue::String(text) if member.key == *key && !text.trim().is_empty() => {
                Some(text.as_str())
            }
            _ => None,
        })
    })
}

fn first_line(text: &str) -> String {
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    lines.next().unwrap_or_default().to_owned()
}

fn base_name(path: &str) -> &str {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(path)
}
