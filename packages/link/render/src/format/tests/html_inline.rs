//! The inline half of the test-only HTML writer: spans back into nested tags. Spans carry their
//! styles as flags, so where two tags open together the one that stays open longer goes outside.

use super::html::Writer;
use crate::format::model::{FormatLink, FormatSpan, LinkKind};

impl Writer {
    pub(super) fn inlines(&mut self, spans: &[FormatSpan]) {
        let spans: Vec<FormatSpan> = spans.iter().map(|span| self.visible(span)).collect();
        let mut stack: Vec<Tag> = Vec::new();
        for (index, span) in spans.iter().enumerate() {
            let wanted = tags(span);
            let keep = stack.iter().take_while(|tag| wanted.contains(tag)).count();
            while stack.len() > keep {
                let tag = stack.pop();
                self.close_tag(tag);
            }
            let mut missing: Vec<Tag> = wanted
                .into_iter()
                .filter(|tag| !stack.contains(tag))
                .collect();
            missing.sort_by_key(|tag| std::cmp::Reverse(run_length(&spans[index..], tag)));
            for tag in missing {
                self.open_tag(&tag);
                stack.push(tag);
            }
            self.span(span);
        }
        while let Some(tag) = stack.pop() {
            self.close_tag(Some(tag));
        }
    }

    /// A bare link is a link only where its extension is on: GitHub's for URLs and addresses
    /// (with `gfm`), never for the paths Broski links on its own.
    fn visible(&self, span: &FormatSpan) -> FormatSpan {
        let mut span = span.clone();
        let hide = span.link.as_ref().is_some_and(|link| {
            link.bare && (!self.gfm || matches!(link.kind, LinkKind::File { .. }))
        });
        if hide {
            span.link = None;
        }
        span
    }

    fn open_tag(&mut self, tag: &Tag) {
        match tag {
            Tag::Emphasis => self.out.push_str("<em>"),
            Tag::Strong => self.out.push_str("<strong>"),
            Tag::Strike => self.out.push_str("<del>"),
            Tag::Link(link) if !link.image => {
                self.out.push_str(&format!(
                    "<a href=\"{}\"",
                    escape(&normalize_uri(&href(link)))
                ));
                if let Some(title) = &link.title {
                    self.out.push_str(&format!(" title=\"{}\"", escape(title)));
                }
                self.out.push('>');
            }
            Tag::Link(_) => {}
        }
    }

    fn close_tag(&mut self, tag: Option<Tag>) {
        match tag {
            Some(Tag::Emphasis) => self.out.push_str("</em>"),
            Some(Tag::Strong) => self.out.push_str("</strong>"),
            Some(Tag::Strike) => self.out.push_str("</del>"),
            Some(Tag::Link(link)) if !link.image => self.out.push_str("</a>"),
            _ => {}
        }
    }

    fn span(&mut self, span: &FormatSpan) {
        if let Some(link) = span.link.as_ref().filter(|link| link.image) {
            self.out.push_str(&format!(
                "<img src=\"{}\" alt=\"{}\"",
                escape(&normalize_uri(&href(link))),
                escape(&span.text)
            ));
            if let Some(title) = &link.title {
                self.out.push_str(&format!(" title=\"{}\"", escape(title)));
            }
            self.out.push_str(" />");
        } else if span.code {
            self.out
                .push_str(&format!("<code>{}</code>", escape(&span.text)));
        } else if span.html {
            self.out.push_str(&span.text);
        } else if span.math {
            self.out.push_str(&format!(
                "<span class=\"math\">{}</span>",
                escape(&span.text)
            ));
        } else {
            self.out.push_str(&escape(&span.text));
        }
    }
}

#[derive(Clone, PartialEq)]
enum Tag {
    Emphasis,
    Strong,
    Strike,
    Link(FormatLink),
}

fn tags(span: &FormatSpan) -> Vec<Tag> {
    let mut tags = Vec::new();
    if let Some(link) = &span.link {
        if link.kind != LinkKind::Footnote {
            tags.push(Tag::Link(link.clone()));
        }
    }
    if span.strike {
        tags.push(Tag::Strike);
    }
    if span.emphasis {
        tags.push(Tag::Emphasis);
    }
    if span.strong {
        tags.push(Tag::Strong);
    }
    tags
}

/// How many spans from the first keep `tag`: the longer a tag stays, the further out it opens.
fn run_length(spans: &[FormatSpan], tag: &Tag) -> usize {
    spans
        .iter()
        .take_while(|span| tags(span).contains(tag))
        .count()
}

fn href(link: &FormatLink) -> String {
    match link.kind {
        LinkKind::File {
            line: Some(line),
            column,
        } => {
            let column = column
                .map(|column| format!(":{column}"))
                .unwrap_or_default();
            format!("{}:{line}{column}", link.target)
        }
        _ => link.target.clone(),
    }
}

pub(super) fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// The reference implementations' URL encoding: percent-encodes what is not safe in a URL, keeps
/// existing `%XX` escapes.
fn normalize_uri(uri: &str) -> String {
    const SAFE: &[u8] = b";/?:@&=+$,-_.!~*'()#";
    let bytes = uri.as_bytes();
    let mut out = String::new();
    let mut at = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        let escape_kept = byte == b'%'
            && bytes.get(at + 1).is_some_and(u8::is_ascii_hexdigit)
            && bytes.get(at + 2).is_some_and(u8::is_ascii_hexdigit);
        if byte.is_ascii_alphanumeric() || SAFE.contains(&byte) || escape_kept {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
        at += 1;
    }
    out
}
