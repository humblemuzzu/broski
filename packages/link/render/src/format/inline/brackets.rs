//! Links and images: brackets pushed as they open, matched to a destination or a reference when
//! they close, earlier link openers deactivated (no links in links); and footnote references.

use super::links::{link_destination, link_label, link_title, spaces_and_newline};
use super::{Bracket, Inline, Linked, Piece};
use crate::format::links::written_link;

impl Inline<'_> {
    pub(super) fn open_bracket(&mut self) -> bool {
        if self.footnote_reference() {
            return true;
        }
        self.pos += 1;
        self.add_bracket(false);
        true
    }

    pub(super) fn bang(&mut self) -> bool {
        if self.text.as_bytes().get(self.pos + 1) != Some(&b'[') {
            return false;
        }
        self.pos += 2;
        self.add_bracket(true);
        true
    }

    fn add_bracket(&mut self, image: bool) {
        let marker = if image { "![" } else { "[" };
        let item = self.push(marker.to_owned(), Piece::Pinned);
        if let Some(last) = self.brackets.last_mut() {
            last.bracket_after = true;
        }
        self.brackets.push(Bracket {
            item,
            prev_delim: self.top,
            image,
            active: true,
            bracket_after: false,
            inside: self.pos,
        });
    }

    /// `[^label]`: a footnote reference, whether or not its definition has arrived yet.
    fn footnote_reference(&mut self) -> bool {
        let rest = &self.text[self.pos..];
        let Some(inner) = rest.strip_prefix("[^") else {
            return false;
        };
        let Some(end) = inner.find(|c: char| c == ']' || c == '[' || c.is_whitespace()) else {
            return false;
        };
        let label = &inner[..end];
        if inner.as_bytes()[end] != b']' || label.is_empty() || label.len() > 999 {
            return false;
        }
        let label = label.to_owned();
        self.pos += end + 3;
        self.push(label, Piece::Footnote);
        true
    }

    pub(super) fn close_bracket(&mut self) -> bool {
        self.pos += 1;
        let after = self.pos;
        let Some(opener) = self.brackets.last().cloned() else {
            self.push_text("]");
            return true;
        };
        if !opener.active {
            self.brackets.pop();
            self.push_text("]");
            return true;
        }
        if self.streaming && self.half_written_destination() {
            self.items[opener.item].text.clear();
            self.brackets.pop();
            self.pos = self.text.len();
            return true;
        }
        match self.link_target(&opener, after) {
            Some((destination, title)) => self.make_link(&opener, destination, title),
            None => {
                self.brackets.pop();
                self.pos = after;
                self.push_text("]");
            }
        }
        true
    }

    /// `](` with no `)` after it yet: the link's destination is still arriving.
    fn half_written_destination(&self) -> bool {
        let rest = &self.text[self.pos..];
        rest.starts_with('(') && !rest.contains(')')
    }

    /// The destination and title after `]`: inline, else a full, collapsed or shortcut reference.
    fn link_target(&mut self, opener: &Bracket, after: usize) -> Option<(String, Option<String>)> {
        if let Some((destination, title, end)) = self.inline_link(after) {
            self.pos = end;
            return Some((destination, title));
        }
        let label_length = link_label(&self.text[after..]).unwrap_or(0);
        let label = if label_length > 2 {
            &self.text[after + 1..after + label_length - 1]
        } else if !opener.bracket_after {
            &self.text[opener.inside..after - 1]
        } else {
            return None;
        };
        let reference = self.refs.get(label)?;
        let found = (reference.destination.clone(), reference.title.clone());
        self.pos = after + label_length;
        Some(found)
    }

    fn inline_link(&self, open: usize) -> Option<(String, Option<String>, usize)> {
        let text = self.text;
        if text.as_bytes().get(open) != Some(&b'(') {
            return None;
        }
        let mut at = open + 1;
        at += spaces_and_newline(&text[at..]);
        let (destination, used) = link_destination(&text[at..])?;
        at += used;
        let gap = spaces_and_newline(&text[at..]);
        let mut title = None;
        if gap > 0 {
            if let Some((found, used)) = link_title(&text[at + gap..]) {
                title = Some(found);
                at += gap + used;
            }
        }
        at += spaces_and_newline(&text[at..]);
        (text.as_bytes().get(at) == Some(&b')')).then(|| (destination, title, at + 1))
    }

    fn make_link(&mut self, opener: &Bracket, destination: String, title: Option<String>) {
        let mut link = written_link(&destination);
        link.title = title.filter(|title| !title.is_empty());
        link.image = opener.image;
        if self.items.len() == opener.item + 1 {
            self.push(String::new(), Piece::Pinned);
        }
        self.links.push(Linked {
            start: opener.item + 1,
            end: self.items.len(),
            link,
        });
        self.push(String::new(), Piece::Pinned);
        self.process_emphasis(opener.prev_delim);
        self.brackets.pop();
        self.items[opener.item].text.clear();
        if !opener.image {
            for bracket in &mut self.brackets {
                if !bracket.image {
                    bracket.active = false;
                }
            }
        }
    }
}
