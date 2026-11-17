//! The seven kinds of HTML block (CommonMark §4.6): how each starts, and how the first five end.

use crate::format::inline::raw_html::{close_tag, open_tag, tag_name};

const RAW_TAGS: [&str; 4] = ["pre", "script", "style", "textarea"];

const BLOCK_TAGS: [&str; 62] = [
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// The kind of HTML block `rest` (from `<`) opens; the seventh cannot interrupt a paragraph.
pub(super) fn start(rest: &str, in_paragraph: bool) -> Option<u8> {
    if starts_raw(rest) {
        Some(1)
    } else if rest.starts_with("<!--") {
        Some(2)
    } else if rest.starts_with("<?") {
        Some(3)
    } else if rest.len() > 2 && rest.starts_with("<!") && rest.as_bytes()[2].is_ascii_alphabetic() {
        Some(4)
    } else if rest.starts_with("<![CDATA[") {
        Some(5)
    } else if starts_block_tag(rest) {
        Some(6)
    } else if !in_paragraph && whole_tag(rest) {
        Some(7)
    } else {
        None
    }
}

/// Whether `line` ends an HTML block of kind `start`; kinds 6 and 7 end at a blank line instead.
pub(super) fn ends(start: u8, line: &str) -> bool {
    match start {
        1 => {
            let lower = line.to_ascii_lowercase();
            RAW_TAGS
                .iter()
                .any(|tag| lower.contains(&format!("</{tag}>")))
        }
        2 => line.contains("-->"),
        3 => line.contains("?>"),
        4 => line.contains('>'),
        5 => line.contains("]]>"),
        _ => false,
    }
}

fn starts_raw(rest: &str) -> bool {
    let Some(name_length) = rest.get(1..).and_then(|after| tag_name(after.as_bytes())) else {
        return false;
    };
    let name = rest[1..1 + name_length].to_ascii_lowercase();
    RAW_TAGS.contains(&name.as_str())
        && matches!(
            rest.as_bytes().get(1 + name_length),
            None | Some(b' ' | b'\t' | b'>')
        )
}

fn starts_block_tag(rest: &str) -> bool {
    let at = if rest.starts_with("</") { 2 } else { 1 };
    let Some(name_length) = rest.get(at..).and_then(|after| tag_name(after.as_bytes())) else {
        return false;
    };
    let name = rest[at..at + name_length].to_ascii_lowercase();
    let after = &rest[at + name_length..];
    BLOCK_TAGS.contains(&name.as_str())
        && (after.is_empty() || after.starts_with([' ', '\t', '>']) || after.starts_with("/>"))
}

/// A whole open or closing tag with nothing but spaces after it on the line.
fn whole_tag(rest: &str) -> bool {
    open_tag(rest)
        .or_else(|| close_tag(rest))
        .is_some_and(|end| rest[end..].trim_matches([' ', '\t']).is_empty())
}
