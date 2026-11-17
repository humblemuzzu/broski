//! JSON pretty-printed as code lines with token kinds, so an MCP tool's result or a call's nested
//! arguments read like code in both apps' code colours. Members keep the order they were written in.

use broski_contract::JsonValue;

use crate::highlight::{CodeLine, CodeSpan, TokenKind};

/// JSON larger than this is shown as the text it is.
pub const MAX_JSON_BYTES: usize = 256 * 1024;
/// Lines past this are left out, with a last line saying how many.
const MAX_JSON_LINES: usize = 5_000;

/// `text` pretty-printed when it is a JSON object or array; `None` for anything else.
pub fn format_json(text: &str) -> Option<Vec<CodeLine>> {
    let trimmed = text.trim();
    if trimmed.len() > MAX_JSON_BYTES || !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return None;
    }
    let value: JsonValue = serde_json::from_str(trimmed).ok()?;
    Some(json_lines(&value))
}

/// `value` as indented lines, two spaces a level.
pub fn json_lines(value: &JsonValue) -> Vec<CodeLine> {
    let mut printer = Printer {
        lines: Vec::new(),
        current: Vec::new(),
        cut: 0,
    };
    printer.value(value, 0);
    printer.end_line();
    if printer.cut > 0 {
        printer.lines.push(CodeLine {
            spans: vec![span(
                &format!("… {} more lines", printer.cut),
                TokenKind::Comment,
            )],
        });
    }
    printer.lines
}

struct Printer {
    lines: Vec<CodeLine>,
    current: Vec<CodeSpan>,
    cut: usize,
}

fn span(text: &str, kind: TokenKind) -> CodeSpan {
    CodeSpan {
        text: text.to_owned(),
        kind,
    }
}

impl Printer {
    fn push(&mut self, text: &str, kind: TokenKind) {
        match self.current.last_mut() {
            Some(last) if last.kind == kind => last.text.push_str(text),
            _ => self.current.push(span(text, kind)),
        }
    }

    fn end_line(&mut self) {
        let spans = std::mem::take(&mut self.current);
        if self.lines.len() >= MAX_JSON_LINES {
            self.cut += 1;
        } else {
            self.lines.push(CodeLine { spans });
        }
    }

    fn indent(&mut self, depth: usize) {
        if depth > 0 {
            self.push(&"  ".repeat(depth), TokenKind::Plain);
        }
    }

    fn value(&mut self, value: &JsonValue, depth: usize) {
        match value {
            JsonValue::Null => self.push("null", TokenKind::Constant),
            JsonValue::Bool(flag) => {
                self.push(if *flag { "true" } else { "false" }, TokenKind::Constant)
            }
            JsonValue::Number(number) => self.push(&number_text(*number), TokenKind::Number),
            JsonValue::String(text) => self.push(&quoted(text), TokenKind::String),
            JsonValue::Array(items) => self.array(items, depth),
            JsonValue::Object(members) => self.object(members, depth),
        }
    }

    fn array(&mut self, items: &[JsonValue], depth: usize) {
        if items.is_empty() {
            self.push("[]", TokenKind::Punctuation);
            return;
        }
        self.push("[", TokenKind::Punctuation);
        for (index, item) in items.iter().enumerate() {
            self.end_line();
            self.indent(depth + 1);
            self.value(item, depth + 1);
            if index + 1 < items.len() {
                self.push(",", TokenKind::Punctuation);
            }
        }
        self.end_line();
        self.indent(depth);
        self.push("]", TokenKind::Punctuation);
    }

    fn object(&mut self, members: &[broski_contract::JsonMember], depth: usize) {
        if members.is_empty() {
            self.push("{}", TokenKind::Punctuation);
            return;
        }
        self.push("{", TokenKind::Punctuation);
        for (index, member) in members.iter().enumerate() {
            self.end_line();
            self.indent(depth + 1);
            self.push(&quoted(&member.key), TokenKind::Property);
            self.push(": ", TokenKind::Punctuation);
            self.value(&member.value, depth + 1);
            if index + 1 < members.len() {
                self.push(",", TokenKind::Punctuation);
            }
        }
        self.end_line();
        self.indent(depth);
        self.push("}", TokenKind::Punctuation);
    }
}

/// A number as JavaScript writes it: no fraction on a whole number.
pub(crate) fn number_text(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{number:.0}")
    } else {
        number.to_string()
    }
}

fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}
