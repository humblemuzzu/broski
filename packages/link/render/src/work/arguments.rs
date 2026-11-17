//! A call's arguments as the person reads them, in the work fold and on a permission card: a
//! property list in the order the agent wrote them. Short values sit on their key's line; long
//! text goes under its key; code (a file's new content, a replacement, a patch) is code in its
//! file's language; a markdown value (a subagent's prompt, a plan) is formatted; an object or a list
//! opens into its members, one level further in.

use broski_contract::{JsonMember, JsonValue};

use super::{text_of, tool_kind, ToolFacts, ToolKind, COMMAND_KEYS, PATH_KEYS};
use crate::format::number_text;
use crate::highlight::{language_for_path, TokenKind};
use crate::text::{clip_text, ClipEnd};
use crate::work::body::looks_like_markdown;

/// A value this short, on one line, sits beside its key.
const INLINE_CHARS: usize = 60;
/// Rows shown; a call with more says how many it left out.
const MAX_ROWS: usize = 200;
/// Levels an object opens into; deeper ones show as JSON.
const MAX_DEPTH: u32 = 4;
/// Lines of one long value kept; a file written whole can be megabytes.
const VALUE_LINES: u32 = 400;
/// Keys whose text is code, and the language it is in when no file says otherwise.
const CODE_KEYS: [(&str, Option<&str>); 12] = [
    ("content", None),
    ("old_string", None),
    ("new_string", None),
    ("new_source", None),
    ("code", None),
    ("patch", Some("diff")),
    ("diff", Some("diff")),
    ("command", Some("bash")),
    ("cmd", Some("bash")),
    ("script", Some("bash")),
    ("sql", Some("sql")),
    ("regex", None),
];
/// Keys whose text is the agent's own prose.
const PROSE_KEYS: [&str; 8] = [
    "prompt",
    "plan",
    "description",
    "message",
    "body",
    "instructions",
    "task",
    "question",
];

#[derive(Debug, Clone, PartialEq)]
pub struct ToolArgument {
    /// The member's key; a list's items are numbered from 1.
    pub key: String,
    /// How far in: members of a value at depth 0 are at depth 1.
    pub depth: u32,
    pub value: ArgumentValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ArgumentValue {
    /// Short text, a number, `true` or `null`, on the key's line, coloured by `kind`.
    Inline { text: String, kind: TokenKind },
    /// Long or multi-line text, under its key, wrapping.
    Text { text: String, hidden_lines: u32 },
    /// Code under its key, in `language` (what `highlight` takes).
    Code {
        text: String,
        language: Option<String>,
        hidden_lines: u32,
    },
    /// The agent's own markdown: formatted, folded to a few lines.
    Markdown { text: String },
    /// An object or list; its members follow at the next depth.
    Nested { count: u32, list: bool },
    /// The arguments past the shown rows.
    More { count: u32 },
}

/// The arguments of `facts` as rows; a command tool's command is left out, since its row shows it.
pub fn tool_arguments(facts: &ToolFacts) -> Vec<ToolArgument> {
    let Some(input) = facts.input.as_ref() else {
        return Vec::new();
    };
    let file = text_of(Some(input), &PATH_KEYS).and_then(language_for_path);
    let command =
        tool_kind(facts) == ToolKind::Command && text_of(Some(input), &COMMAND_KEYS).is_some();
    let mut rows = Rows {
        rows: Vec::new(),
        file,
        left_out: 0,
    };
    match input {
        JsonValue::Object(members) => {
            for member in members {
                if command && COMMAND_KEYS.contains(&member.key.as_str()) {
                    continue;
                }
                rows.member(member, 0);
            }
        }
        other => rows.value("input".to_owned(), other, 0),
    }
    if rows.left_out > 0 {
        let count = u32::try_from(rows.left_out).unwrap_or(u32::MAX);
        rows.rows.push(ToolArgument {
            key: String::new(),
            depth: 0,
            value: ArgumentValue::More { count },
        });
    }
    rows.rows
}

struct Rows {
    rows: Vec<ToolArgument>,
    /// The language of the file the call names, for its code values.
    file: Option<String>,
    left_out: usize,
}

impl Rows {
    fn push(&mut self, key: String, depth: u32, value: ArgumentValue) {
        if self.rows.len() >= MAX_ROWS {
            self.left_out += 1;
            return;
        }
        self.rows.push(ToolArgument { key, depth, value });
    }

    fn member(&mut self, member: &JsonMember, depth: u32) {
        self.value(member.key.clone(), &member.value, depth);
    }

    fn value(&mut self, key: String, value: &JsonValue, depth: u32) {
        let inline = |text: String, kind| ArgumentValue::Inline { text, kind };
        match value {
            JsonValue::Null => {
                self.push(key, depth, inline("null".to_owned(), TokenKind::Constant))
            }
            JsonValue::Bool(flag) => {
                self.push(key, depth, inline(flag.to_string(), TokenKind::Constant))
            }
            JsonValue::Number(number) => {
                self.push(key, depth, inline(number_text(*number), TokenKind::Number))
            }
            JsonValue::String(text) => {
                let shown = self.text_value(&key, text);
                self.push(key, depth, shown);
            }
            JsonValue::Array(items) => self.list(key, items, depth),
            JsonValue::Object(members) => self.object(key, members, depth),
        }
    }

    fn text_value(&self, key: &str, text: &str) -> ArgumentValue {
        let lower = key.to_ascii_lowercase();
        if let Some((_, language)) = CODE_KEYS.iter().find(|(known, _)| *known == lower) {
            let language = self.file.clone().or_else(|| language.map(str::to_owned));
            let clip = clip_text(text, VALUE_LINES, ClipEnd::Head);
            return ArgumentValue::Code {
                text: clip.text,
                language,
                hidden_lines: clip.hidden_lines,
            };
        }
        let short = text.chars().count() <= INLINE_CHARS && !text.contains('\n');
        if short {
            return ArgumentValue::Inline {
                text: text.to_owned(),
                kind: TokenKind::String,
            };
        }
        if PROSE_KEYS.contains(&lower.as_str()) || looks_like_markdown(text) {
            return ArgumentValue::Markdown {
                text: clip_text(text, VALUE_LINES, ClipEnd::Head).text,
            };
        }
        let clip = clip_text(text, VALUE_LINES, ClipEnd::Head);
        ArgumentValue::Text {
            text: clip.text,
            hidden_lines: clip.hidden_lines,
        }
    }

    fn list(&mut self, key: String, items: &[JsonValue], depth: u32) {
        if items.is_empty() {
            return self.push(
                key,
                depth,
                ArgumentValue::Inline {
                    text: "[]".to_owned(),
                    kind: TokenKind::Punctuation,
                },
            );
        }
        if let Some(text) = compact(items) {
            return self.push(
                key,
                depth,
                ArgumentValue::Inline {
                    text,
                    kind: TokenKind::String,
                },
            );
        }
        if depth >= MAX_DEPTH {
            return self.as_json(key, &JsonValue::Array(items.to_vec()), depth);
        }
        let count = u32::try_from(items.len()).unwrap_or(u32::MAX);
        self.push(key, depth, ArgumentValue::Nested { count, list: true });
        for (index, item) in items.iter().enumerate() {
            self.value((index + 1).to_string(), item, depth + 1);
        }
    }

    fn object(&mut self, key: String, members: &[JsonMember], depth: u32) {
        if depth >= MAX_DEPTH {
            return self.as_json(key, &JsonValue::Object(members.to_vec()), depth);
        }
        let count = u32::try_from(members.len()).unwrap_or(u32::MAX);
        self.push(key, depth, ArgumentValue::Nested { count, list: false });
        for member in members {
            self.member(member, depth + 1);
        }
    }

    fn as_json(&mut self, key: String, value: &JsonValue, depth: u32) {
        let text = serde_json::to_string_pretty(value).unwrap_or_default();
        let clip = clip_text(&text, VALUE_LINES, ClipEnd::Head);
        let value = ArgumentValue::Code {
            text: clip.text,
            language: Some("json".to_owned()),
            hidden_lines: clip.hidden_lines,
        };
        self.push(key, depth, value);
    }
}

/// A list of short words or numbers, comma-separated, when it fits on the key's line.
fn compact(items: &[JsonValue]) -> Option<String> {
    let words: Option<Vec<String>> = items
        .iter()
        .map(|item| match item {
            JsonValue::String(text) if !text.contains('\n') => Some(text.clone()),
            JsonValue::Number(number) => Some(number_text(*number)),
            JsonValue::Bool(flag) => Some(flag.to_string()),
            _ => None,
        })
        .collect();
    let joined = words?.join(", ");
    (joined.chars().count() <= INLINE_CHARS).then_some(joined)
}
