//! Long text as a row shows it: a few lines from the end that matters, and how many were left out.
//! Nothing in the chat draws a tool's output, a log or a notice whole; it draws a clip and opens the
//! rest on a tap.

use crate::prefix;

/// The most a clip holds, whatever its lines: one line of minified JSON can be a megabyte.
pub const MAX_CLIP_BYTES: usize = 16_384;

/// The text a preview reads: its opening words are all it shows.
const PREVIEW_SOURCE_BYTES: usize = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipEnd {
    /// The first lines: a command's printed result, a message.
    Head,
    /// The last lines: a log, where the newest output matters.
    Tail,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextClip {
    /// The lines kept, joined by `\n`, without the text's leading or trailing blank lines.
    pub text: String,
    /// Lines of the text the clip leaves out, whole or in part.
    pub hidden_lines: u32,
}

/// At most `max_lines` lines of `text` and `MAX_CLIP_BYTES` bytes, from the end `keep` names.
pub fn clip_text(text: &str, max_lines: u32, keep: ClipEnd) -> TextClip {
    let lines: Vec<&str> = text.trim_matches('\n').lines().collect();
    let shown = (max_lines as usize).min(lines.len());
    let kept = match keep {
        ClipEnd::Head => &lines[..shown],
        ClipEnd::Tail => &lines[lines.len() - shown..],
    };
    let joined = kept.join("\n");
    let (text, cut) = within_bytes(&joined, keep);
    let hidden = lines.len() - shown + usize::from(cut);
    TextClip {
        text,
        hidden_lines: u32::try_from(hidden).unwrap_or(u32::MAX),
    }
}

/// The text cut to `MAX_CLIP_BYTES` at a line break where there is one, else at a character; and
/// whether anything was cut.
fn within_bytes(text: &str, keep: ClipEnd) -> (String, bool) {
    if text.len() <= MAX_CLIP_BYTES {
        return (text.to_owned(), false);
    }
    let kept = match keep {
        ClipEnd::Head => {
            let head = prefix(text, MAX_CLIP_BYTES);
            head.rfind('\n').map_or(head, |at| &head[..at])
        }
        ClipEnd::Tail => {
            let mut start = text.len() - MAX_CLIP_BYTES;
            while !text.is_char_boundary(start) {
                start += 1;
            }
            let tail = &text[start..];
            tail.find('\n').map_or(tail, |at| &tail[at + 1..])
        }
    };
    (kept.to_owned(), true)
}

/// The opening words of a text on one line, for a preview under a title; at most `max_chars`
/// characters, with `…` where it was cut. Empty when the text says nothing.
pub fn opening_words(text: &str, max_chars: u32) -> String {
    let source = prefix(text, PREVIEW_SOURCE_BYTES);
    let flat = source.split_whitespace().collect::<Vec<_>>().join(" ");
    let max = max_chars as usize;
    if flat.chars().count() <= max {
        return flat;
    }
    let cut: String = flat.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

/// A duration as the chat words it: `12s`, `2m`, `1h 5m`.
pub fn format_duration(milliseconds: i64) -> String {
    let seconds = milliseconds.max(0).saturating_add(500) / 1000;
    if seconds < 60 {
        return format!("{seconds}s");
    }
    if seconds < 3600 {
        return format!("{}m", seconds / 60);
    }
    let minutes = seconds / 60 % 60;
    if minutes == 0 {
        format!("{}h", seconds / 3600)
    } else {
        format!("{}h {minutes}m", seconds / 3600)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbered(count: usize) -> String {
        (1..=count)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn a_log_keeps_its_last_lines_and_a_message_its_first() {
        let text = format!("\n{}\n\n", numbered(30));
        let tail = clip_text(&text, 3, ClipEnd::Tail);
        assert_eq!(tail.text, "line 28\nline 29\nline 30");
        assert_eq!(tail.hidden_lines, 27);
        let head = clip_text(&text, 2, ClipEnd::Head);
        assert_eq!(head.text, "line 1\nline 2");
        assert_eq!(head.hidden_lines, 28);
        assert_eq!(clip_text("one\ntwo", 12, ClipEnd::Tail).hidden_lines, 0);
    }

    #[test]
    fn one_huge_line_is_cut_to_the_byte_bound_and_counted_as_hidden() {
        let huge = "é".repeat(MAX_CLIP_BYTES);
        for keep in [ClipEnd::Head, ClipEnd::Tail] {
            let clip = clip_text(&huge, 12, keep);
            assert!(clip.text.len() <= MAX_CLIP_BYTES);
            assert!(!clip.text.is_empty());
            assert_eq!(clip.hidden_lines, 1);
        }
        let lines = format!("{}\nlast line", "x".repeat(MAX_CLIP_BYTES));
        assert_eq!(clip_text(&lines, 12, ClipEnd::Tail).text, "last line");
    }

    #[test]
    fn a_preview_is_the_opening_words_on_one_line() {
        let text = "Done.\n\nAll tests pass\nin a.ts.";
        assert_eq!(opening_words(text, 240), "Done. All tests pass in a.ts.");
        assert_eq!(opening_words(text, 10), "Done. All…");
        assert_eq!(opening_words("\n\n  \n", 240), "");
    }

    #[test]
    fn durations_read_as_the_work_fold_words_them() {
        assert_eq!(format_duration(0), "0s");
        assert_eq!(format_duration(12_499), "12s");
        assert_eq!(format_duration(59_500), "1m");
        assert_eq!(format_duration(3_599_000), "59m");
        assert_eq!(format_duration(3_600_000), "1h");
        assert_eq!(format_duration(3_900_000), "1h 5m");
    }
}
