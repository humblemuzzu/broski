//! Which words of a text, a path or a command a speech model would get wrong: identifiers, file
//! names, flags, oddly cased product names. Ordinary English is left out; the model already knows it.

use crate::terms::MAX_TERM_CHARS;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Kind {
    /// `useEffect`, `snake_case`, `ML-KEM`, `x86_64`, `SwiftUI`.
    Identifier,
    /// `limits.ts`, `Next.js`.
    File,
    /// `--dangerously-skip-permissions`.
    Flag,
    /// `PTY`, `APNS`.
    Acronym,
    /// A capitalised word inside a sentence: `Postgres`, `Broski`.
    ProperNoun,
}

impl Kind {
    pub(crate) fn weight(self) -> f64 {
        match self {
            Kind::Identifier | Kind::File => 1.0,
            Kind::Flag => 0.6,
            Kind::ProperNoun => 0.5,
            Kind::Acronym => 0.4,
        }
    }
}

const FORBIDDEN: &[char] = &[
    '=', '(', ')', '{', '}', '[', ']', '<', '>', '"', '\'', '`', '$', '\\', '|', ';', '*', '!',
    '?', ',', '%', '^', '~', '#',
];

/// Never worth a slot: they are what the model already writes.
const COMMON_ACRONYMS: &[&str] = &[
    "THE",
    "AND",
    "FOR",
    "NOT",
    "BUT",
    "YOU",
    "ALL",
    "ARE",
    "WAS",
    "THIS",
    "THAT",
    "WITH",
    "TODO",
    "NOTE",
    "FIXME",
    "IMPORTANT",
    "WARNING",
    "ERROR",
    "YES",
    "DONE",
    "FAIL",
    "PASS",
    "OK",
];

const SHELL_BUILTINS: &[&str] = &[
    "cd", "ls", "cat", "echo", "sed", "awk", "grep", "head", "tail", "rm", "cp", "mv", "mkdir",
    "find", "xargs", "sort", "uniq", "wc", "tr", "cut", "true", "false", "sleep", "export",
    "source", "set", "test", "printf", "touch", "chmod", "sh", "bash", "zsh", "env", "time",
    "timeout", "sudo", "which", "pwd", "open", "trash", "for", "if", "while", "do", "then", "done",
];

/// Whether `term` can go to the model at all: one to three words, at most [`MAX_TERM_CHARS`], no
/// syntax.
pub(crate) fn sendable(term: &str) -> bool {
    let length = term.chars().count();
    (2..=MAX_TERM_CHARS).contains(&length)
        && term.split_whitespace().count() <= 3
        && term.chars().any(|c| c.is_alphabetic())
        && !term.contains(FORBIDDEN)
        && !term.contains("://")
        && !term.chars().any(char::is_control)
}

/// The kind of name `word` reads as, if any. `word` is one token, without spaces.
pub(crate) fn classify(word: &str) -> Option<Kind> {
    if !sendable(word) || word.contains('/') {
        return None;
    }
    if let Some(flag) = word.strip_prefix("--") {
        let valid = flag.len() >= 3
            && flag
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        return valid.then_some(Kind::Flag);
    }
    if word.starts_with('-') || word.ends_with('-') || is_quantity(word) {
        return None;
    }
    if is_file(word) {
        return Some(Kind::File);
    }
    let letters = word.chars().any(|c| c.is_alphabetic());
    let digits = word.chars().any(|c| c.is_ascii_digit());
    let upper_inside = word
        .chars()
        .zip(word.chars().skip(1))
        .any(|(before, after)| {
            after.is_uppercase() && (before.is_lowercase() || before.is_ascii_digit())
        });
    let uppers = word.chars().filter(|c| c.is_uppercase()).count();
    let lowers = word.chars().filter(|c| c.is_lowercase()).count();
    if word.contains('_') && letters
        || upper_inside
        || uppers >= 2 && lowers >= 1
        || word.contains('-') && (uppers > 0 || digits)
    {
        return Some(Kind::Identifier);
    }
    if digits && letters && word.chars().count() >= 3 {
        return Some(Kind::Identifier);
    }
    if lowers == 0 && (3..=8).contains(&uppers) && !COMMON_ACRONYMS.contains(&word) {
        return Some(Kind::Acronym);
    }
    None
}

/// `limits.ts`, `Next.js`, `Cargo.toml`; not `e.g`, `0.3.325` or `U.S`.
fn is_file(word: &str) -> bool {
    let Some((base, extension)) = word.rsplit_once('.') else {
        return false;
    };
    let first = word.split('.').next().unwrap_or_default();
    (1..=8).contains(&extension.len())
        && extension.chars().all(|c| c.is_ascii_alphanumeric())
        && extension.chars().any(|c| c.is_ascii_alphabetic())
        && first.chars().count() >= 2
        && base.chars().any(|c| c.is_alphabetic())
}

/// `3rd`, `10ms`, `4MiB`, `2x`: a number with a unit, which the model writes by itself.
fn is_quantity(word: &str) -> bool {
    let unit = word.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.');
    unit.len() < word.len() && unit.len() <= 3 && unit.chars().all(|c| c.is_ascii_alphabetic())
}

/// A token of prose without what wraps it: quotes, brackets, closing punctuation, a possessive,
/// and the call parentheses of `useEffect()`.
pub(crate) fn trim_token(token: &str) -> &str {
    let wrapper = |c: char| {
        matches!(
            c,
            '"' | '\''
                | '`'
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '<'
                | '>'
                | ','
                | ';'
                | '*'
                | '“'
                | '”'
                | '‘'
                | '’'
        )
    };
    let mut token = token;
    loop {
        let next = token
            .trim_matches(wrapper)
            .trim_end_matches(['.', ':', '!', '?']);
        let next = next.strip_suffix("()").unwrap_or(next);
        let next = next
            .strip_suffix("'s")
            .or_else(|| next.strip_suffix("’s"))
            .unwrap_or(next);
        if next == token {
            return token;
        }
        token = next;
    }
}

/// The names in prose, each with its kind. A capitalised word counts as a name only inside a
/// sentence, where it cannot be a sentence's first word.
pub(crate) fn prose(text: &str) -> Vec<(String, Kind)> {
    let mut names = Vec::new();
    let mut starts_sentence = true;
    for raw in text.split_whitespace() {
        let word = trim_token(raw);
        if let Some(kind) = classify(word) {
            names.push((word.to_owned(), kind));
        } else if !starts_sentence && is_proper_noun(word) {
            names.push((word.to_owned(), Kind::ProperNoun));
        }
        starts_sentence = raw.ends_with(['.', '!', '?', ':']) || raw.starts_with(['-', '•']);
    }
    names
}

fn is_proper_noun(word: &str) -> bool {
    let mut chars = word.chars();
    chars.next().is_some_and(char::is_uppercase)
        && word.chars().count() >= 3
        && chars.all(|c| c.is_lowercase())
        && sendable(word)
}

/// What a path gives: its file or folder name always, the name without its extension when that
/// reads as an identifier (`SessionView`), and the path itself when it is short and relative.
pub(crate) fn path_names(path: &str) -> Vec<String> {
    let path = path.trim().trim_end_matches('/');
    let Some(name) = path.rsplit('/').next().filter(|name| !name.is_empty()) else {
        return Vec::new();
    };
    if !is_name(name) {
        return Vec::new();
    }
    let mut names = vec![name.to_owned()];
    names.extend(identifier_stem(name).map(str::to_owned));
    let relative = !path.starts_with(['/', '~']);
    let depth = path.split('/').count();
    if relative && (2..=3).contains(&depth) && sendable(path) {
        names.push(path.to_owned());
    }
    names
}

/// `SessionView` of `SessionView.swift`: a file's name without its extension, when that reads as
/// an identifier the person may say on its own.
pub(crate) fn identifier_stem(name: &str) -> Option<&str> {
    let (stem, _) = name.rsplit_once('.')?;
    (classify(stem) == Some(Kind::Identifier)).then_some(stem)
}

/// A file or folder name worth a slot: `limits.ts`, `SessionView`, `broski-link`; not `src` or
/// `tmp`, which the model spells by itself, nor a hidden `.github`.
pub(crate) fn is_name(name: &str) -> bool {
    sendable(name)
        && !name.starts_with('.')
        && (classify(name).is_some() || name.contains(['-', '_']))
}

/// A span of inline code: a path's names, a short phrase as it is (`bun test`), or the names in a
/// longer one.
pub(crate) fn code_span(span: &str) -> Vec<String> {
    let span = trim_token(span.trim());
    if span.contains('/') && !span.contains(' ') {
        return path_names(span);
    }
    if span.split_whitespace().count() > 3 {
        return command(span);
    }
    if sendable(span) {
        return vec![span.to_owned()];
    }
    Vec::new()
}

/// A shell command's program (`kubectl`), its subcommand pair (`cargo clippy`), its flags and the
/// names of the files it touches. Generic shell words are left out.
pub(crate) fn command(line: &str) -> Vec<String> {
    let mut names = Vec::new();
    for segment in line.split(['|', ';', '&', '\n']) {
        let mut words = segment
            .split_whitespace()
            .skip_while(|word| word.contains('='));
        let Some(program) = words
            .next()
            .map(|word| word.rsplit('/').next().unwrap_or(word))
        else {
            continue;
        };
        let rest: Vec<&str> = words.collect();
        if is_program(program) {
            names.push(program.to_owned());
            if let Some(sub) = rest.first().filter(|sub| is_subcommand(sub)) {
                names.push(format!("{program} {sub}"));
            }
        }
        for word in rest.iter().map(|word| trim_token(word)) {
            if word.contains('/') {
                names.extend(path_names(word));
            } else if classify(word).is_some() {
                names.push(word.to_owned());
            }
        }
    }
    names
}

fn is_program(word: &str) -> bool {
    word.len() >= 2
        && !SHELL_BUILTINS.contains(&word)
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && word.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
}

fn is_subcommand(word: &str) -> bool {
    word.len() >= 2
        && word.chars().all(|c| c.is_ascii_lowercase() || c == '-')
        && !word.starts_with('-')
}

#[cfg(test)]
#[path = "words_tests.rs"]
mod tests;
