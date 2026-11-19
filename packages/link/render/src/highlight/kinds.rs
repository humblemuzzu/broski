//! Maps `@pierre/highlights` token IDs to Broski's `TokenKind`.

use super::generated::TOKEN_TYPES;
use super::TokenKind;

const KIND_TABLE: [TokenKind; TOKEN_TYPES.len()] = build_table();

const fn build_table() -> [TokenKind; TOKEN_TYPES.len()] {
    let mut table = [TokenKind::Plain; TOKEN_TYPES.len()];
    let mut i = 0;
    while i < TOKEN_TYPES.len() {
        table[i] = map_name(TOKEN_TYPES[i]);
        i += 1;
    }
    table
}

pub(super) fn kind_for(token_id: u32) -> TokenKind {
    KIND_TABLE
        .get(token_id as usize)
        .copied()
        .unwrap_or(TokenKind::Plain)
}

/// Maps every token name from `generated::TOKEN_TYPES` to a `TokenKind`.
pub(super) const fn map_name(name: &str) -> TokenKind {
    match name.as_bytes() {
        b"comment" | b"comment.doc" => TokenKind::Comment,
        b"keyword"
        | b"keyword.control"
        | b"keyword.declaration"
        | b"keyword.import"
        | b"keyword.jsdoc"
        | b"preproc" => TokenKind::Keyword,
        b"operator" | b"keyword.operator" => TokenKind::Operator,
        b"string"
        | b"string.regex"
        | b"string.special"
        | b"string.special.symbol"
        | b"text.literal" => TokenKind::String,
        b"number" => TokenKind::Number,
        b"constant" | b"constant.builtin" | b"boolean" | b"string.escape" | b"variant" => {
            TokenKind::Constant
        }
        b"type" | b"type.builtin" | b"type.class" | b"type.jsdoc" | b"constructor"
        | b"namespace" | b"enum" => TokenKind::Type,
        b"function" | b"function.definition" | b"function.method" => TokenKind::Function,
        b"variable.parameter" | b"variable.special" | b"variable.jsdoc" => TokenKind::Variable,
        b"property" | b"property.json_key" | b"label" => TokenKind::Property,
        b"punctuation"
        | b"punctuation.bracket"
        | b"punctuation.bracket.html"
        | b"punctuation.bracket.jsx"
        | b"punctuation.delimiter"
        | b"punctuation.delimiter.html"
        | b"punctuation.delimiter.jsx"
        | b"punctuation.list_marker"
        | b"punctuation.markup"
        | b"punctuation.special" => TokenKind::Punctuation,
        b"tag" | b"tag.doctype" | b"tag.jsx" | b"tag.component.jsx" | b"selector"
        | b"selector.class" | b"selector.id" | b"selector.pseudo" => TokenKind::Tag,
        b"attribute" | b"attribute.jsx" => TokenKind::Attribute,
        b"diff.plus" => TokenKind::Inserted,
        b"diff.minus" => TokenKind::Deleted,
        b"title" => TokenKind::Heading,
        _ => TokenKind::Plain,
    }
}

#[cfg(test)]
pub(super) fn is_known_token_name(name: &str) -> bool {
    matches!(
        name,
        "none"
            | "attribute"
            | "attribute.jsx"
            | "boolean"
            | "comment"
            | "comment.doc"
            | "constant"
            | "constant.builtin"
            | "constructor"
            | "diff.minus"
            | "diff.plus"
            | "embedded"
            | "emphasis"
            | "emphasis.strong"
            | "function"
            | "function.definition"
            | "function.method"
            | "keyword"
            | "keyword.control"
            | "keyword.declaration"
            | "keyword.import"
            | "keyword.operator"
            | "label"
            | "namespace"
            | "number"
            | "operator"
            | "predictive"
            | "preproc"
            | "primary"
            | "property"
            | "property.json_key"
            | "punctuation"
            | "punctuation.bracket"
            | "punctuation.bracket.html"
            | "punctuation.bracket.jsx"
            | "punctuation.delimiter"
            | "punctuation.delimiter.html"
            | "punctuation.delimiter.jsx"
            | "punctuation.list_marker"
            | "punctuation.markup"
            | "punctuation.special"
            | "selector"
            | "selector.class"
            | "selector.id"
            | "string"
            | "string.escape"
            | "string.regex"
            | "string.special"
            | "string.special.symbol"
            | "tag"
            | "tag.doctype"
            | "tag.jsx"
            | "text.jsx"
            | "text.literal"
            | "title"
            | "type"
            | "type.builtin"
            | "type.class"
            | "variable"
            | "variable.parameter"
            | "variable.special"
            | "enum"
            | "hint"
            | "keyword.jsdoc"
            | "link_text"
            | "link_uri"
            | "selector.pseudo"
            | "tag.component.jsx"
            | "type.jsdoc"
            | "variable.jsdoc"
            | "variant"
            | "background"
            | "foreground"
    )
}
