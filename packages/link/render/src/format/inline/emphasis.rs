//! Matching emphasis delimiters (CommonMark §6.2, "process emphasis"), with the openers-bottom
//! bound per character, opener-ness and length mod 3 that keeps the search linear. GitHub's `~~`
//! matches like `*` but only with another pair.

use super::{Inline, Style, Styled};

impl Inline<'_> {
    pub(super) fn process_emphasis(&mut self, bottom: Option<usize>) {
        let mut openers_bottom = [bottom; 14];
        let mut closer = self.first_above(bottom);
        while let Some(current) = closer {
            let delim = &self.delims[current];
            if !delim.can_close {
                closer = delim.next;
                continue;
            }
            let bucket = bucket(delim.ch, delim.can_open, delim.original);
            match self.find_opener(current, bottom, openers_bottom[bucket]) {
                Some(opener) => closer = self.match_pair(opener, current),
                None => {
                    closer = self.delims[current].next;
                    openers_bottom[bucket] = self.delims[current].prev;
                    if !self.delims[current].can_open {
                        self.remove_delim(current);
                    }
                }
            }
        }
        if bottom.is_none() && self.streaming {
            self.close_open_emphasis();
        }
        while let Some(top) = self.top {
            if Some(top) == bottom {
                break;
            }
            self.remove_delim(top);
        }
    }

    fn first_above(&self, bottom: Option<usize>) -> Option<usize> {
        let mut closer = self.top;
        while let Some(current) = closer {
            if self.delims[current].prev == bottom {
                return Some(current);
            }
            closer = self.delims[current].prev;
        }
        None
    }

    fn find_opener(
        &self,
        closer: usize,
        bottom: Option<usize>,
        floor: Option<usize>,
    ) -> Option<usize> {
        let close = &self.delims[closer];
        let mut opener = close.prev;
        while let Some(current) = opener {
            if Some(current) == bottom || Some(current) == floor {
                return None;
            }
            let open = &self.delims[current];
            let odd = (close.can_open || open.can_close)
                && !close.original.is_multiple_of(3)
                && (open.original + close.original).is_multiple_of(3);
            let tilde_pair = close.ch != b'~' || open.count == close.count;
            if open.ch == close.ch && open.can_open && !odd && tilde_pair {
                return Some(current);
            }
            opener = open.prev;
        }
        None
    }

    /// Styles the pieces between a matched pair; returns the closer to look at next.
    fn match_pair(&mut self, opener: usize, closer: usize) -> Option<usize> {
        let ch = self.delims[closer].ch;
        let both_long = self.delims[closer].count >= 2 && self.delims[opener].count >= 2;
        let used = if ch == b'~' || both_long { 2 } else { 1 };
        let style = match (ch, used) {
            (b'~', _) => Style::Strike,
            (_, 2) => Style::Strong,
            _ => Style::Emphasis,
        };
        let (open_item, close_item) = (self.delims[opener].item, self.delims[closer].item);
        self.delims[opener].count -= used;
        self.delims[closer].count -= used;
        shorten(&mut self.items[open_item].text, used);
        shorten(&mut self.items[close_item].text, used);
        self.styles.push(Styled {
            start: open_item + 1,
            end: close_item,
            style,
        });
        self.delims[opener].next = Some(closer);
        self.delims[closer].prev = Some(opener);
        if self.delims[opener].count == 0 {
            self.remove_delim(opener);
        }
        if self.delims[closer].count == 0 {
            let next = self.delims[closer].next;
            self.remove_delim(closer);
            return next;
        }
        Some(closer)
    }

    /// While streaming, an opener on the last line with no closer yet styles the text after it, as
    /// its closer would once it arrives.
    fn close_open_emphasis(&mut self) {
        let mut current = self.top;
        while let Some(index) = current {
            let delim = &self.delims[index];
            current = delim.prev;
            if !delim.can_open || delim.count == 0 || delim.at < self.last_line {
                continue;
            }
            let styles: &[Style] = match (delim.ch, delim.count) {
                (b'~', _) => &[Style::Strike],
                (_, 1) => &[Style::Emphasis],
                (_, 2) => &[Style::Strong],
                _ => &[Style::Strong, Style::Emphasis],
            };
            let item = delim.item;
            for style in styles {
                self.styles.push(Styled {
                    start: item + 1,
                    end: self.items.len(),
                    style: *style,
                });
            }
            self.items[item].text.clear();
        }
    }

    pub(super) fn remove_delim(&mut self, index: usize) {
        let (prev, next) = (self.delims[index].prev, self.delims[index].next);
        if let Some(prev) = prev {
            self.delims[prev].next = next;
        }
        match next {
            Some(next) => self.delims[next].prev = prev,
            None => self.top = prev,
        }
    }
}

/// Which openers-bottom a closer uses: by character, whether it can also open, and its length
/// mod 3 (tildes have one length).
fn bucket(ch: u8, can_open: bool, original: usize) -> usize {
    match ch {
        b'_' => usize::from(can_open) * 3 + original % 3,
        b'*' => 6 + usize::from(can_open) * 3 + original % 3,
        _ => 12 + usize::from(can_open),
    }
}

fn shorten(text: &mut String, used: usize) {
    let kept = text.len().saturating_sub(used);
    text.truncate(kept);
}
