//! Links in text that was not written as a link: `<…>` autolinks (CommonMark §6.5), GitHub's
//! extended autolinks (bare `https://`, `www.` and addresses, GFM §6.9), and pages named without
//! their scheme. A path in prose stays text: nothing says the file is there, and a word drawn as a
//! link must open something. A log's path with a line (`src/lib.rs:7`, as a compiler or `grep`
//! prints it) is the exception: a tool wrote it about a file it read.

use crate::format::links::{bare_image_link, is_path, path_link, short_url, written_link};
use crate::format::model::{FormatLink, FormatSpan, LinkKind};

/// `<scheme:…>` or `<address@host>`: the bytes it takes and its link.
pub(super) fn angle(text: &str) -> Option<(usize, FormatLink)> {
    let end = text[1..].find(|c: char| c == '>' || c == '<' || c.is_whitespace())? + 1;
    if text.as_bytes()[end] != b'>' {
        return None;
    }
    let inner = &text[1..end];
    if uri(inner) {
        return Some((end + 1, written_link(inner)));
    }
    if email(inner) {
        let link = FormatLink {
            kind: LinkKind::Mail,
            target: format!("mailto:{inner}"),
            title: None,
            image: false,
            bare: false,
        };
        return Some((end + 1, link));
    }
    None
}

fn uri(text: &str) -> bool {
    let Some((scheme, rest)) = text.split_once(':') else {
        return false;
    };
    let mut chars = scheme.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && (2..=32).contains(&scheme.len())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        && !rest.bytes().any(|b| b <= b' ' || b == b'<' || b == b'>')
}

fn email(text: &str) -> bool {
    let Some((local, domain)) = text.split_once('@') else {
        return false;
    };
    let local_ok = !local.is_empty()
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+/=?^_`{|}~-".contains(&b));
    local_ok && !domain.is_empty() && domain.split('.').all(domain_label)
}

fn domain_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub(super) struct Extended {
    pub length: usize,
    pub display: String,
    pub link: FormatLink,
}

/// A bare `http://`, `https://` or `www.` link at the start of `text`, its trailing punctuation
/// left out as GitHub does. A host needs no dot after a scheme, so `http://localhost:3000` links.
pub(super) fn extended(text: &str) -> Option<Extended> {
    let lower = text.get(..8).unwrap_or(text).to_ascii_lowercase();
    let (prefix, needs_dot) = if lower.starts_with("https://") {
        (8, false)
    } else if lower.starts_with("http://") {
        (7, false)
    } else if lower.starts_with("ftp://") {
        (6, true)
    } else if lower.starts_with("www.") {
        (0, true)
    } else {
        return None;
    };
    let host = domain_length(&text[prefix..], needs_dot)?;
    let end = prefix + host + path_length(&text[prefix + host..]);
    let length = trimmed_length(&text[..end]);
    let source = &text[..length];
    let target = if prefix == 0 {
        format!("http://{source}")
    } else {
        source.to_owned()
    };
    Some(Extended {
        length,
        display: short_url(source),
        link: FormatLink {
            kind: if prefix == 6 {
                LinkKind::Inert
            } else {
                LinkKind::Web
            },
            target,
            title: None,
            image: false,
            bare: true,
        },
    })
}

/// A domain: segments of letters, digits, `_` and `-` between dots, no `_` in the last two.
fn domain_length(text: &str, needs_dot: bool) -> Option<usize> {
    let length = text
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        .count();
    let domain = text[..length].trim_end_matches('.');
    let segments: Vec<&str> = domain.split('.').collect();
    if domain.is_empty() || segments.iter().any(|segment| segment.is_empty()) {
        return None;
    }
    if needs_dot && segments.len() < 2 {
        return None;
    }
    let tail = &segments[segments.len().saturating_sub(2)..];
    if tail.iter().any(|segment| segment.contains('_')) {
        return None;
    }
    Some(domain.len())
}

fn path_length(text: &str) -> usize {
    text.find(|c: char| c.is_whitespace() || c == '<')
        .unwrap_or(text.len())
}

/// Without trailing punctuation, unbalanced closing parentheses and an entity-like `&x;`.
fn trimmed_length(link: &str) -> usize {
    let mut end = link.len();
    loop {
        let text = &link[..end];
        let before = end;
        end = text
            .trim_end_matches(['?', '!', '.', ',', ':', '*', '_', '~'])
            .len();
        let text = &link[..end];
        if text.ends_with(')') && text.matches(')').count() > text.matches('(').count() {
            end -= 1;
        } else if let Some(entity) = text.strip_suffix(';') {
            let stem = entity.trim_end_matches(|c: char| c.is_ascii_alphanumeric());
            if stem.ends_with('&') && stem.len() < entity.len() {
                end = stem.len() - 1;
            }
        }
        if end == before {
            return end;
        }
    }
}

/// A link found in plain text: an address or a page, by byte range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BareLink {
    pub start: usize,
    pub end: usize,
    pub link: FormatLink,
}

/// The addresses and scheme-less pages in `text`, in order, and with `positioned_paths` the paths
/// that name a line. (Web links with a scheme are found during the pass, before emphasis can split
/// them.)
pub(crate) fn bare_links(text: &str, positioned_paths: bool) -> Vec<BareLink> {
    let mut found = Vec::new();
    let mut at = 0;
    for word in text.split_inclusive(char::is_whitespace) {
        let word_start = at;
        at += word.len();
        let word = word.trim_end();
        let lead = word.len()
            - word
                .trim_start_matches(['(', '[', '"', '\'', '<', '`'])
                .len();
        let core = &word[lead..];
        let core = &core[..trimmed_length(core)];
        let core = core.trim_end_matches(['"', '\'', ']', '>', ';', '`']);
        if core.is_empty() {
            continue;
        }
        let start = word_start + lead;
        let email =
            word[lead..].trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '"', '\'', '>']);
        if let Some(link) = bare_email(email) {
            found.push(BareLink {
                start,
                end: start + email.len(),
                link,
            });
            continue;
        }
        let link = host_link(core)
            .or_else(|| bare_image_link(core))
            .or_else(|| {
                let path = (positioned_paths && is_path(core)).then(|| path_link(core, true))?;
                matches!(path.kind, LinkKind::File { line: Some(_), .. }).then_some(path)
            });
        if let Some(link) = link {
            found.push(BareLink {
                start,
                end: start + core.len(),
                link,
            });
        }
    }
    found
}

/// Top-level domains a host written without a scheme is recognised by, so `github.com/a/b.ts` opens
/// the page rather than looking for a file of that name.
const KNOWN_TLDS: [&str; 30] = [
    "com", "org", "net", "io", "dev", "app", "ai", "co", "gg", "rs", "sh", "me", "so", "ly", "to",
    "tv", "us", "uk", "de", "in", "edu", "gov", "info", "page", "site", "tech", "cloud", "run",
    "xyz", "pk",
];

/// `host.tld/path`: a web page named without its scheme, linked as `https://`.
pub(crate) fn host_link(word: &str) -> Option<FormatLink> {
    let (host, rest) = word.split_once('/')?;
    let tld = host.rsplit_once('.')?.1;
    let known = KNOWN_TLDS.contains(&tld.to_ascii_lowercase().as_str());
    let whole_host = domain_length(host, true) == Some(host.len());
    let path_ok = !rest.contains(['\\', '"', '\'', '<', '>']);
    (known && whole_host && path_ok).then(|| FormatLink {
        kind: LinkKind::Web,
        target: format!("https://{word}"),
        title: None,
        image: false,
        bare: true,
    })
}

/// GitHub's address autolink: letters, digits, `.`, `-`, `_`, `+` before the `@`, a dotted host
/// after it that ends in a letter or digit.
fn bare_email(word: &str) -> Option<FormatLink> {
    let (local, domain) = word.split_once('@')?;
    let local_ok = !local.is_empty()
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'+'));
    let domain_ok = domain.contains('.')
        && domain.ends_with(|c: char| c.is_ascii_alphanumeric())
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        });
    (local_ok && domain_ok).then(|| FormatLink {
        kind: LinkKind::Mail,
        target: format!("mailto:{word}"),
        title: None,
        image: false,
        bare: true,
    })
}

/// Plain text (a log line, not markdown) as spans with its web links, addresses and the paths that
/// name a line linked.
pub(crate) fn linked_text(text: &str) -> Vec<FormatSpan> {
    let mut spans = Vec::new();
    let mut plain_from = 0;
    let mut at = 0;
    let bytes = text.as_bytes();
    while at < bytes.len() {
        let starts_word = at == 0
            || matches!(
                bytes[at - 1],
                b' ' | b'\t' | b'(' | b'"' | b'\'' | b'<' | b'[' | b'='
            );
        let found = if starts_word && matches!(bytes[at], b'h' | b'H' | b'w' | b'W') {
            extended(&text[at..])
        } else {
            None
        };
        match found {
            Some(link) => {
                plain_spans(&text[plain_from..at], &mut spans);
                spans.push(FormatSpan {
                    text: text[at..at + link.length].to_owned(),
                    link: Some(link.link),
                    ..FormatSpan::default()
                });
                at += link.length;
                plain_from = at;
            }
            None => at += text[at..].chars().next().map_or(1, char::len_utf8),
        }
    }
    plain_spans(&text[plain_from..], &mut spans);
    spans
}

fn plain_spans(text: &str, spans: &mut Vec<FormatSpan>) {
    let mut at = 0;
    for bare in bare_links(text, true) {
        if bare.start > at {
            spans.push(FormatSpan {
                text: text[at..bare.start].to_owned(),
                ..FormatSpan::default()
            });
        }
        spans.push(FormatSpan {
            text: text[bare.start..bare.end].to_owned(),
            link: Some(bare.link),
            ..FormatSpan::default()
        });
        at = bare.end;
    }
    if at < text.len() {
        spans.push(FormatSpan {
            text: text[at..].to_owned(),
            ..FormatSpan::default()
        });
    }
}
