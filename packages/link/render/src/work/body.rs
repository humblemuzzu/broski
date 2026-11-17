//! How a tool's result reads when the bridge gave it no display of its own: a subagent's report as
//! markdown, a read as numbered lines of its file, a search as rows that open their files, JSON
//! pretty-printed, markdown-looking text formatted, anything else as a log with its links found.
//! The adapters' `markdown` and `file_text` displays are drawn directly; this is the fallback for
//! MCP and unknown tools, and for results whose tool says nothing of its shape.

use broski_contract::JsonValue;

use super::{text_of, tool_kind, ToolFacts, ToolKind};
use crate::format::{format_json, is_path, linked_text, FormatSpan};
use crate::highlight::CodeLine;
use crate::text::{clip_text, ClipEnd};

/// Lines of a log drawn in place; a tool can print megabytes.
pub const TOOL_LOG_LINES: u32 = 200;
/// How much of a result is looked at to decide what it is.
const SNIFF_BYTES: usize = 8_192;
const OFFSET_KEYS: [&str; 2] = ["offset", "start_line"];

#[derive(Debug, Clone, PartialEq)]
pub enum ToolBody {
    /// No output to show.
    Empty,
    Markdown {
        text: String,
    },
    /// A file's lines, numbered from `first_line`; `language` is what `highlight` takes.
    FileText {
        path: String,
        language: Option<String>,
        first_line: u32,
        text: String,
    },
    /// Search results, each opening its file (at its line when it has one).
    Matches {
        rows: Vec<MatchRow>,
        hidden_rows: u32,
    },
    Json {
        lines: Vec<CodeLine>,
    },
    /// A log's last lines, with the web links, addresses and paths in them linked.
    Log {
        lines: Vec<LogLine>,
        hidden_lines: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchRow {
    pub path: String,
    pub line: Option<u32>,
    /// The matching line, the searched-for text marked; empty for a file search.
    pub segments: Vec<MatchSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchSegment {
    pub text: String,
    pub matched: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLine {
    pub spans: Vec<FormatSpan>,
}

/// Rows of a search shown in place; the rest are counted.
const MATCH_ROWS: usize = 200;

/// How the result `output` of the call `facts` reads.
pub fn tool_body(facts: &ToolFacts, output: &str) -> ToolBody {
    if output.trim().is_empty() {
        return ToolBody::Empty;
    }
    let input = facts.input.as_ref();
    match tool_kind(facts) {
        ToolKind::Agent => markdown(output),
        ToolKind::Read => file_text(input, output).unwrap_or_else(|| log(output)),
        ToolKind::Search => matches(input, output).unwrap_or_else(|| log(output)),
        ToolKind::Web if looks_like_markdown(output) => markdown(output),
        ToolKind::Command | ToolKind::Edit | ToolKind::Web => log(output),
        ToolKind::Other => match format_json(output) {
            Some(lines) => ToolBody::Json { lines },
            None if looks_like_markdown(output) => markdown(output),
            None => log(output),
        },
    }
}

fn markdown(output: &str) -> ToolBody {
    ToolBody::Markdown {
        text: output.trim().to_owned(),
    }
}

fn log(output: &str) -> ToolBody {
    let log = format_log(output, TOOL_LOG_LINES, ClipEnd::Tail);
    ToolBody::Log {
        lines: log.lines,
        hidden_lines: log.hidden_lines,
    }
}

/// Text that is not markdown (a log, an error, a command), as at most `max_lines` lines from the
/// end `keep` names, with the web links, addresses and paths in it linked.
pub fn format_log(text: &str, max_lines: u32, keep: ClipEnd) -> LogText {
    let clip = clip_text(text, max_lines, keep);
    LogText {
        lines: clip
            .text
            .split('\n')
            .map(|line| LogLine {
                spans: linked_text(line),
            })
            .collect(),
        hidden_lines: clip.hidden_lines,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogText {
    pub lines: Vec<LogLine>,
    pub hidden_lines: u32,
}

/// A read's lines: numbered as `cat -n` numbers them (`  12\t…` or `  12→…`, as Claude Code's
/// model reads a file) from the first number, else the text as it is from the call's offset.
fn file_text(input: Option<&JsonValue>, output: &str) -> Option<ToolBody> {
    let path = text_of(input, &super::PATH_KEYS)?.to_owned();
    let language = crate::highlight::language_for_path(&path);
    if let Some((first_line, text)) = numbered_lines(output) {
        return Some(ToolBody::FileText {
            path,
            language,
            first_line,
            text,
        });
    }
    let first_line = number_of(input, &OFFSET_KEYS).unwrap_or(1).max(1);
    Some(ToolBody::FileText {
        path,
        language,
        first_line,
        text: output.to_owned(),
    })
}

/// `cat -n` output: every line a number, then a tab or an arrow, counting up by one.
fn numbered_lines(output: &str) -> Option<(u32, String)> {
    let mut first = None;
    let mut text = String::with_capacity(output.len());
    for (index, line) in output.trim_end_matches('\n').split('\n').enumerate() {
        let trimmed = line.trim_start();
        let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
        let number: u32 = trimmed.get(..digits)?.parse().ok()?;
        let rest = &trimmed[digits..];
        let content = rest.strip_prefix('\t').or_else(|| rest.strip_prefix('→'))?;
        let start = *first.get_or_insert(number);
        if u64::from(number) != u64::from(start) + index as u64 {
            return None;
        }
        if index > 0 {
            text.push('\n');
        }
        text.push_str(content);
    }
    first.map(|first| (first, text))
}

fn number_of(input: Option<&JsonValue>, keys: &[&str]) -> Option<u32> {
    let JsonValue::Object(members) = input? else {
        return None;
    };
    members.iter().find_map(|member| match member.value {
        JsonValue::Number(number) if keys.contains(&member.key.as_str()) && number >= 1.0 => {
            u32::try_from(number as u64).ok()
        }
        _ => None,
    })
}

/// A search's lines as rows when most of them are `path:line:text` or a path alone.
fn matches(input: Option<&JsonValue>, output: &str) -> Option<ToolBody> {
    let pattern = text_of(input, &super::PATTERN_KEYS).filter(|pattern| is_literal(pattern));
    let lines: Vec<&str> = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let rows: Vec<MatchRow> = lines
        .iter()
        .filter_map(|line| match_row(line, pattern))
        .collect();
    if rows.is_empty() || rows.len() * 10 < lines.len() * 8 {
        return None;
    }
    let hidden = rows.len().saturating_sub(MATCH_ROWS);
    Some(ToolBody::Matches {
        rows: rows.into_iter().take(MATCH_ROWS).collect(),
        hidden_rows: u32::try_from(hidden).unwrap_or(u32::MAX),
    })
}

fn match_row(line: &str, pattern: Option<&str>) -> Option<MatchRow> {
    let mut parts = line.splitn(3, ':');
    let path = parts.next()?.trim();
    let number = parts
        .next()
        .and_then(|part| part.trim().parse::<u32>().ok());
    let named = path.contains('/') || is_path(path) || path.contains('.');
    if !named || path.is_empty() || path.contains(char::is_whitespace) {
        return None;
    }
    match (number, parts.next()) {
        (Some(line_number), Some(text)) => Some(MatchRow {
            path: path.to_owned(),
            line: Some(line_number),
            segments: marked(text, pattern),
        }),
        (None, None) if !line.contains(':') => Some(MatchRow {
            path: path.to_owned(),
            line: None,
            segments: Vec::new(),
        }),
        _ => None,
    }
}

/// A pattern with no regular-expression syntax, which can be found in the text as written.
fn is_literal(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.contains([
            '\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|',
        ])
}

fn marked(text: &str, pattern: Option<&str>) -> Vec<MatchSegment> {
    let Some(pattern) = pattern else {
        return vec![MatchSegment {
            text: text.to_owned(),
            matched: false,
        }];
    };
    let mut segments = Vec::new();
    let mut at = 0;
    for (start, found) in text.match_indices(pattern) {
        if start > at {
            segments.push(MatchSegment {
                text: text[at..start].to_owned(),
                matched: false,
            });
        }
        segments.push(MatchSegment {
            text: found.to_owned(),
            matched: true,
        });
        at = start + found.len();
    }
    if at < text.len() {
        segments.push(MatchSegment {
            text: text[at..].to_owned(),
            matched: false,
        });
    }
    segments
}

/// Whether text reads as markdown: a heading, a list, a fence, a table, bold or a link.
pub(crate) fn looks_like_markdown(text: &str) -> bool {
    let sample = crate::prefix(text, SNIFF_BYTES);
    let mut list_items = 0;
    for line in sample.lines() {
        let line = line.trim_start();
        let heading = line.starts_with('#') && line.trim_start_matches('#').starts_with(' ');
        if heading
            || line.starts_with("```")
            || line.starts_with("|---")
            || line.starts_with("| ---")
        {
            return true;
        }
        if line.starts_with("- ") || line.starts_with("* ") || line.starts_with("1. ") {
            list_items += 1;
        }
    }
    list_items >= 2 || sample.contains("**") || sample.contains("](http")
}
