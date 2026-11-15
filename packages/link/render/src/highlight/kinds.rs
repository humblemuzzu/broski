//! A line's scope changes, as syntect reports them, turned into spans of `TokenKind`.

use std::sync::OnceLock;

use syntect::parsing::{ParseState, Scope, ScopeStack, SyntaxSet};

use super::{CodeSpan, TokenKind};

/// Scope prefixes in TextMate's naming conventions, most specific first. A span takes the kind of
/// its innermost scope that one of them names.
const RULES: &[(&str, TokenKind)] = &[
    ("punctuation.definition.string", TokenKind::String),
    ("string", TokenKind::String),
    ("constant.numeric", TokenKind::Number),
    ("constant", TokenKind::Constant),
    ("support.constant", TokenKind::Constant),
    ("keyword.operator", TokenKind::Operator),
    ("keyword", TokenKind::Keyword),
    ("storage", TokenKind::Keyword),
    ("variable.language", TokenKind::Variable),
    ("variable.parameter", TokenKind::Variable),
    ("variable.function", TokenKind::Function),
    ("entity.name.function", TokenKind::Function),
    ("support.function", TokenKind::Function),
    ("entity.name.tag.yaml", TokenKind::Property),
    ("entity.name.tag.toml", TokenKind::Property),
    ("entity.name.tag", TokenKind::Tag),
    ("entity.other.attribute-name", TokenKind::Attribute),
    ("support.type.property-name", TokenKind::Property),
    ("entity.name.section", TokenKind::Heading),
    ("entity.name", TokenKind::Type),
    ("entity.other.inherited-class", TokenKind::Type),
    ("support.type", TokenKind::Type),
    ("support.class", TokenKind::Type),
    ("markup.inserted", TokenKind::Inserted),
    ("markup.deleted", TokenKind::Deleted),
    ("markup.heading", TokenKind::Heading),
    ("meta.diff.range", TokenKind::Heading),
    ("meta.diff.header", TokenKind::Heading),
    ("punctuation", TokenKind::Punctuation),
];

struct Rules {
    comment: Scope,
    /// A mapping's key is a property even when quoted (JSON), which makes it a string inside.
    key: Scope,
    rules: Vec<(Scope, TokenKind)>,
}

fn rules() -> &'static Rules {
    static RULES_BUILT: OnceLock<Rules> = OnceLock::new();
    RULES_BUILT.get_or_init(|| Rules {
        comment: scope("comment"),
        key: scope("meta.mapping.key"),
        rules: RULES
            .iter()
            .map(|(prefix, kind)| (scope(prefix), *kind))
            .collect(),
    })
}

fn scope(name: &str) -> Scope {
    Scope::new(name).unwrap_or_else(|error| panic!("the rule {name} is a scope: {error:?}"))
}

/// What the stack's scopes make a span: a comment or a mapping's key wherever it is nested,
/// otherwise the kind of the innermost scope a rule names.
fn kind(stack: &ScopeStack) -> TokenKind {
    let rules = rules();
    let scopes = stack.as_slice();
    let within = |outer: Scope| scopes.iter().any(|&scope| outer.is_prefix_of(scope));
    if within(rules.comment) {
        return TokenKind::Comment;
    }
    if within(rules.key) {
        return TokenKind::Property;
    }
    scopes
        .iter()
        .rev()
        .find_map(|&scope| {
            rules
                .rules
                .iter()
                .find(|(prefix, _)| prefix.is_prefix_of(scope))
                .map(|(_, kind)| *kind)
        })
        .unwrap_or(TokenKind::Plain)
}

/// One line (with its line break, as the grammars expect) as spans without the break; `None`
/// when the grammar fails on it.
pub(super) fn spans(
    state: &mut ParseState,
    stack: &mut ScopeStack,
    syntaxes: &SyntaxSet,
    line: &str,
) -> Option<Vec<CodeSpan>> {
    let ops = state.parse_line(line, syntaxes).ok()?;
    let text = line.strip_suffix('\n').unwrap_or(line);
    let text = text.strip_suffix('\r').unwrap_or(text);
    let mut spans = Vec::new();
    let mut cursor = 0;
    for (at, op) in ops {
        let at = at.min(text.len());
        if at > cursor {
            push(&mut spans, &text[cursor..at], kind(stack));
            cursor = at;
        }
        stack.apply(&op).ok()?;
    }
    push(&mut spans, &text[cursor..], kind(stack));
    Some(spans)
}

fn push(spans: &mut Vec<CodeSpan>, text: &str, kind: TokenKind) {
    if text.is_empty() {
        return;
    }
    match spans.last_mut() {
        Some(last) if last.kind == kind => last.text.push_str(text),
        _ => spans.push(CodeSpan {
            text: text.to_owned(),
            kind,
        }),
    }
}
