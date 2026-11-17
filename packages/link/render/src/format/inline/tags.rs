//! `<…>`: an autolink, or inline HTML. HTML is never run: a tag stays text as written, except the
//! few that only style text and arrive in pairs (`<kbd>⌘</kbd>`, `<b>…</b>`), which style the text
//! between them and are not shown, and `<br>`, which breaks the line as agents mean it in tables.

use super::{autolink, raw_html, Inline, Linked, Piece, Style, Styled};

/// Tags that only style their text, and the style: none for those that change nothing a phone
/// draws (`<u>`, `<sup>`, `<span>`), whose tags are simply not shown.
const STYLE_TAGS: [(&str, Option<Style>); 14] = [
    ("b", Some(Style::Strong)),
    ("strong", Some(Style::Strong)),
    ("i", Some(Style::Emphasis)),
    ("em", Some(Style::Emphasis)),
    ("s", Some(Style::Strike)),
    ("del", Some(Style::Strike)),
    ("strike", Some(Style::Strike)),
    ("code", Some(Style::Code)),
    ("kbd", Some(Style::Code)),
    ("u", None),
    ("sup", None),
    ("sub", None),
    ("mark", None),
    ("span", None),
];

impl Inline<'_> {
    pub(super) fn angle(&mut self) -> bool {
        let rest = &self.text[self.pos..];
        if let Some((used, link)) = autolink::angle(rest) {
            let item = self.push(rest[1..used - 1].to_owned(), Piece::Pinned);
            self.links.push(Linked {
                start: item,
                end: item + 1,
                link,
            });
            self.pos += used;
            return true;
        }
        let Some(used) = self.raw_html() else {
            return false;
        };
        let raw = &self.text[self.pos..self.pos + used];
        self.pos += used;
        if is_line_break_tag(raw) {
            self.trim_trailing_spaces();
            self.push_text("\n");
            self.skip_spaces();
            return true;
        }
        let raw = raw.to_owned();
        let item = self.push(raw.clone(), Piece::Html);
        self.pair_style_tag(&raw, item);
        true
    }

    /// Remembers an opening style tag; a closing one that matches an open one styles what lies
    /// between them and hides both.
    fn pair_style_tag(&mut self, raw: &str, item: usize) {
        let Some((name, closing)) = simple_tag(raw) else {
            return;
        };
        let Some(&(_, style)) = STYLE_TAGS.iter().find(|(known, _)| *known == name) else {
            return;
        };
        if !closing {
            self.open_tags.push((name, item));
            return;
        }
        let Some(at) = self.open_tags.iter().rposition(|(open, _)| *open == name) else {
            return;
        };
        let (_, opener) = self.open_tags.remove(at);
        self.open_tags.truncate(at);
        self.items[opener].text.clear();
        self.items[item].text.clear();
        if let Some(style) = style {
            self.styles.push(Styled {
                start: opener + 1,
                end: item,
                style,
            });
        }
    }

    fn raw_html(&mut self) -> Option<usize> {
        let at = self.pos;
        let rest = &self.text[at..];
        if rest.starts_with("<!-->") {
            return Some(5);
        }
        if rest.starts_with("<!--->") {
            return Some(6);
        }
        if rest.starts_with("<!--") {
            return self.find_ahead("-->", at + 4).map(|end| end + 3 - at);
        }
        if rest.starts_with("<![CDATA[") {
            return self.find_ahead("]]>", at + 9).map(|end| end + 3 - at);
        }
        if rest.starts_with("<?") {
            return self.find_ahead("?>", at + 2).map(|end| end + 2 - at);
        }
        if rest.starts_with("<!") {
            if !rest.as_bytes().get(2)?.is_ascii_alphabetic() {
                return None;
            }
            return self.find_ahead(">", at + 2).map(|end| end + 1 - at);
        }
        raw_html::open_tag(rest).or_else(|| raw_html::close_tag(rest))
    }
}

/// `<br>`, `<br/>` or `<br />`, which agents put in table cells to break a line.
fn is_line_break_tag(raw: &str) -> bool {
    let inner = raw[1..raw.len() - 1].trim_end_matches('/').trim();
    inner.eq_ignore_ascii_case("br")
}

/// A tag with no attributes, `<name>` or `</name>`: its name in lower case and whether it closes.
fn simple_tag(raw: &str) -> Option<(String, bool)> {
    let inner = raw.strip_prefix('<')?.strip_suffix('>')?;
    let (name, closing) = match inner.strip_prefix('/') {
        Some(name) => (name, true),
        None => (inner, false),
    };
    let simple = !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_alphabetic());
    simple.then(|| (name.to_ascii_lowercase(), closing))
}
