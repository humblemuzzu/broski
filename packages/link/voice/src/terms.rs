//! The names a session uses, ranked for the speech model: the person's own dictionary first, the
//! project's folder name, then what the conversation, the folder and git name most and most lately.

use std::collections::{HashMap, HashSet};

use broski_contract::{BlockKind, FilesListed, GitStatusRead, TranscriptItem};
use broski_render::{format_markdown, tool_look, FormatContent, FormatSpan, ToolFacts};

use crate::words::{self, Kind};

/// xAI takes at most 100 key terms of at most 50 characters each.
pub const MAX_TERMS: usize = 100;
pub const MAX_TERM_CHARS: usize = 50;

/// Only the newest items are read: what was said lately is what the person talks about.
const MAX_ITEMS: usize = 120;

const USER_SPAN: f64 = 6.0;
const AGENT_SPAN: f64 = 5.0;
const USER_WORD: f64 = 4.0;
const AGENT_WORD: f64 = 3.0;
const TOOL_PATH: f64 = 4.0;
const TOOL_COMMAND: f64 = 3.0;
const GIT_PATH: f64 = 5.0;
const BRANCH: f64 = 3.0;
const FOLDER_ENTRY: f64 = 2.5;
/// Thinking and a subagent's text are about the work, less about what the person will say.
const ASIDE: f64 = 0.5;
/// How many items back a name's weight halves.
const HALF_LIFE: f64 = 15.0;

/// Everything a session offers to pick names from. `items` oldest first, as a chat holds them;
/// `folder` and `git` are the session folder's listing and status, when the Mac answered.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DictationSources {
    pub items: Vec<TranscriptItem>,
    pub folder: Option<FilesListed>,
    pub git: Option<GitStatusRead>,
    pub cwd: Option<String>,
    pub dictionary: Vec<String>,
}

/// At most [`MAX_TERMS`] names for the speech model to spell as written, best first.
pub fn dictation_terms(sources: &DictationSources) -> Vec<String> {
    let mut chosen = Chosen::default();
    for word in &sources.dictionary {
        chosen.add(word.trim());
    }
    if let Some(project) = sources
        .cwd
        .as_deref()
        .and_then(|cwd| cwd.trim_end_matches('/').rsplit('/').next())
    {
        chosen.add(project);
    }
    let mut tally = Tally::default();
    for (age, item) in sources.items.iter().rev().take(MAX_ITEMS).enumerate() {
        tally.item(item, 1.0 / (1.0 + age as f64 / HALF_LIFE));
    }
    if let Some(git) = &sources.git {
        tally.git(git);
    }
    if let Some(folder) = &sources.folder {
        tally.folder(folder);
    }
    for term in tally.ranked() {
        if chosen.terms.len() == MAX_TERMS {
            break;
        }
        chosen.add(&term);
    }
    chosen.terms
}

/// The terms in the order they go out, each once whatever its case.
#[derive(Default)]
struct Chosen {
    terms: Vec<String>,
    seen: HashSet<String>,
}

impl Chosen {
    fn add(&mut self, term: &str) {
        if self.terms.len() < MAX_TERMS
            && words::sendable(term)
            && self.seen.insert(term.to_lowercase())
        {
            self.terms.push(term.to_owned());
        }
    }
}

struct Entry {
    term: String,
    score: f64,
    first: usize,
}

/// Each name's summed weight, keyed case-insensitively; the form kept is the one seen first,
/// which is the newest.
#[derive(Default)]
struct Tally {
    entries: HashMap<String, Entry>,
}

impl Tally {
    fn add(&mut self, term: &str, weight: f64) {
        if !words::sendable(term) {
            return;
        }
        let first = self.entries.len();
        self.entries
            .entry(term.to_lowercase())
            .or_insert_with(|| Entry {
                term: term.to_owned(),
                score: 0.0,
                first,
            })
            .score += weight;
    }

    fn ranked(self) -> Vec<String> {
        let mut entries: Vec<Entry> = self.entries.into_values().collect();
        entries.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.first.cmp(&b.first)));
        entries.into_iter().map(|entry| entry.term).collect()
    }

    fn item(&mut self, item: &TranscriptItem, recency: f64) {
        match item {
            TranscriptItem::UserMessage(message) => {
                self.markdown(&message.text, USER_SPAN * recency, USER_WORD * recency);
            }
            TranscriptItem::Block(block) => {
                let aside =
                    block.block == BlockKind::Thinking || block.parent_tool_call_id.is_some();
                let factor = if aside { recency * ASIDE } else { recency };
                self.markdown(&block.text, AGENT_SPAN * factor, AGENT_WORD * factor);
            }
            TranscriptItem::ToolCall(call) => {
                let look = tool_look(&ToolFacts {
                    name: call.name.clone(),
                    title: call.title.clone(),
                    input: call.input.clone(),
                    has_child_session: call.child_session.is_some(),
                    changed_paths: Vec::new(),
                });
                self.paths(look.paths.iter().map(String::as_str), TOOL_PATH * recency);
                for name in look
                    .command
                    .as_deref()
                    .map(words::command)
                    .unwrap_or_default()
                {
                    self.add(&name, TOOL_COMMAND * recency);
                }
            }
            TranscriptItem::ToolResult(result) => {
                let paths = result
                    .result
                    .file_changes
                    .iter()
                    .map(|change| change.path.as_str());
                self.paths(paths, TOOL_PATH * recency);
            }
            _ => {}
        }
    }

    /// Inline code counts at `span`, names in the prose around it at `word` times their kind's
    /// weight. Code blocks are skipped: their keywords are not what the person says.
    fn markdown(&mut self, text: &str, span: f64, word: f64) {
        for block in format_markdown(text, false) {
            match block.content {
                FormatContent::Paragraph { spans } | FormatContent::Heading { spans, .. } => {
                    self.spans(&spans, span, word);
                }
                FormatContent::Table { table } => {
                    for cell in table.header.iter().chain(table.rows.iter().flatten()) {
                        self.spans(&cell.spans, span, word);
                    }
                }
                _ => {}
            }
        }
    }

    fn spans(&mut self, spans: &[FormatSpan], span: f64, word: f64) {
        let mut prose = String::new();
        for run in spans {
            if run.code {
                for name in words::code_span(&run.text) {
                    self.add(&name, span);
                }
                prose.push(' ');
            } else {
                prose.push_str(&run.text);
            }
        }
        for (name, kind) in words::prose(&prose) {
            self.add(&name, word * kind.weight());
            if kind == Kind::File {
                if let Some(stem) = words::identifier_stem(&name) {
                    self.add(stem, word * kind.weight());
                }
            }
        }
    }

    fn paths<'a>(&mut self, paths: impl Iterator<Item = &'a str>, weight: f64) {
        for path in paths {
            for name in words::path_names(path) {
                self.add(&name, weight);
            }
        }
    }

    fn git(&mut self, git: &GitStatusRead) {
        if let Some(branch) = git.branch.as_deref() {
            let last = branch.rsplit('/').next().unwrap_or(branch);
            for name in [branch, last] {
                if words::is_name(name) {
                    self.add(name, BRANCH);
                }
            }
        }
        let changed = git
            .staged
            .iter()
            .chain(&git.unstaged)
            .map(|change| change.path.as_str());
        self.paths(
            changed.chain(git.untracked.iter().map(String::as_str)),
            GIT_PATH,
        );
    }

    fn folder(&mut self, folder: &FilesListed) {
        for entry in &folder.entries {
            if words::is_name(&entry.name) {
                self.add(&entry.name, FOLDER_ENTRY);
                if let Some(stem) = words::identifier_stem(&entry.name) {
                    self.add(stem, FOLDER_ENTRY);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "terms_tests.rs"]
mod tests;
