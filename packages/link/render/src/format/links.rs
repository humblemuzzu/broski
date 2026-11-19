//! What a link is: a page to open, an address to write to, a file in the session's folder, or
//! something never opened. And which words in prose or code are file paths.

use super::model::{FormatLink, LinkKind};

/// A bare URL longer than this shows shortened; its link keeps the whole.
const SHORT_URL_CHARS: usize = 60;

const IMAGE_EXTENSIONS: [&str; 13] = [
    "png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif", "bmp", "tif", "tiff", "svg", "ico",
];

/// Whether `path` ends with a known image file extension.
pub fn is_image_path(path: &str) -> bool {
    let (clean, _, _) = split_position(path.trim());
    let name = clean.rsplit(['/', '\\']).next().unwrap_or(clean);
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty() && IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

/// Decodes a `file://` URL naming an image file into its local filesystem path.
pub(crate) fn image_file_uri(text: &str) -> Option<String> {
    let rest = text
        .strip_prefix("file://")
        .or_else(|| text.strip_prefix("FILE://"))?;
    let path = rest.strip_prefix("localhost").unwrap_or(rest);
    if !path.starts_with('/') {
        return None;
    }
    let decoded = percent_decode(path);
    is_image_path(&decoded).then_some(decoded)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| text.to_owned())
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// The link a written destination (`[label](destination)`) makes. Only `http`, `https` and
/// `mailto` open; `file://` opens when it names an image; any other scheme and an anchor stay
/// text; anything else is a path.
pub(crate) fn written_link(destination: &str) -> FormatLink {
    let lower = destination.to_ascii_lowercase();
    let kind = if lower.starts_with("http://") || lower.starts_with("https://") {
        LinkKind::Web
    } else if lower.starts_with("mailto:") {
        LinkKind::Mail
    } else if let Some(path) = image_file_uri(destination) {
        return path_link(&path, false);
    } else if destination.starts_with('#') || has_scheme(destination) {
        LinkKind::Inert
    } else {
        return path_link(destination, false);
    };
    FormatLink {
        kind,
        target: destination.to_owned(),
        title: None,
        image: false,
        bare: false,
    }
}

/// `scheme:` as URIs start (two to 32 characters); `C:\` is a drive, not a scheme.
fn has_scheme(text: &str) -> bool {
    let Some((scheme, _)) = text.split_once(':') else {
        return false;
    };
    let mut chars = scheme.chars();
    let starts_with_letter = chars.next().is_some_and(|c| c.is_ascii_alphabetic());
    starts_with_letter
        && (2..=32).contains(&scheme.len())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// A file link, the line and column read off a trailing `:12` or `:12:5`.
pub(crate) fn path_link(text: &str, bare: bool) -> FormatLink {
    let (path, line, column) = split_position(text);
    FormatLink {
        kind: LinkKind::File { line, column },
        target: path.to_owned(),
        title: None,
        image: false,
        bare,
    }
}

fn split_position(text: &str) -> (&str, Option<u32>, Option<u32>) {
    let number = |part: &str| -> Option<u32> {
        (!part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())).then(|| part.parse().ok())?
    };
    let Some((rest, last)) = text.rsplit_once(':') else {
        return (text, None, None);
    };
    let Some(last) = number(last) else {
        return (text, None, None);
    };
    match rest.rsplit_once(':') {
        Some((path, line)) if number(line).is_some() && !path.is_empty() => {
            (path, number(line), Some(last))
        }
        _ if rest.is_empty() => (text, None, None),
        _ => (rest, Some(last), None),
    }
}

/// Whether `token` (a word without its surrounding punctuation) names a file: `src/a.ts:42:7`,
/// `~/x`, `./x`, `/usr/bin/env`, `C:\x`. Never a version (`v1.2.3`), an abbreviation (`e.g.`), a
/// bare name (`node.js`), a pair of words (`and/or`) or a route (`/api/v1/users`): a rooted path
/// needs a file name or a system folder at its root.
pub(crate) fn is_path(token: &str) -> bool {
    let (path, _, _) = split_position(token);
    if path.contains("://") || path.chars().any(char::is_whitespace) || path.len() < 3 {
        return false;
    }
    if windows_path(path) {
        return true;
    }
    if !path.contains('/') {
        return false;
    }
    if path.starts_with("~/") || path.starts_with("./") || path.starts_with("../") {
        return true;
    }
    let segments: Vec<&str> = path.split('/').collect();
    let well_formed = segments
        .iter()
        .enumerate()
        .all(|(index, segment)| valid_segment(segment, index == 0, index == segments.len() - 1));
    if !well_formed {
        return false;
    }
    let named = segments.last().is_some_and(|name| has_extension(name));
    let system_root = path.starts_with('/')
        && segments.len() >= 3
        && SYSTEM_ROOTS.contains(&segments[1].to_ascii_lowercase().as_str());
    named || system_root
}

/// A path written inside inline code that names an image file, including macOS screenshot names
/// containing spaces (e.g. `` `/Users/me/Desktop/Screenshot 2026-11-19.png` ``).
pub(crate) fn code_image_link(text: &str) -> Option<FormatLink> {
    if let Some(path) = image_file_uri(text) {
        return Some(path_link(&path, true));
    }
    let trimmed = text.trim();
    if trimmed.contains("://") || trimmed.contains('\n') || !is_image_path(trimmed) {
        return None;
    }
    let rooted = trimmed.starts_with("~/")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || windows_path(trimmed)
        || is_system_rooted(trimmed);
    rooted.then(|| path_link(trimmed, true))
}

/// A bare token in prose or a log that unambiguously names a local image file (`/tmp/shot.png`,
/// `~/Desktop/a.png`, `./out/chart.webp`, `file:///tmp/shot.png`).
pub(crate) fn bare_image_link(token: &str) -> Option<FormatLink> {
    if let Some(path) = image_file_uri(token) {
        return Some(path_link(&path, true));
    }
    if token.contains("://") || token.chars().any(char::is_whitespace) || !is_image_path(token) {
        return None;
    }
    let rooted = token.starts_with("~/")
        || token.starts_with("./")
        || token.starts_with("../")
        || windows_path(token)
        || is_system_rooted(token);
    (rooted && is_path(token)).then(|| path_link(token, true))
}

fn is_system_rooted(path: &str) -> bool {
    let mut parts = path.split('/');
    matches!(parts.next(), Some(""))
        && parts
            .next()
            .is_some_and(|root| SYSTEM_ROOTS.contains(&root.to_ascii_lowercase().as_str()))
        && parts.next().is_some_and(|rest| !rest.is_empty())
}

/// The folders at the root of a Mac or Linux disk, under which a path with no file name is still
/// a path (`/usr/bin/env`); any other rooted path without one reads as a web route.
const SYSTEM_ROOTS: [&str; 18] = [
    "applications",
    "bin",
    "dev",
    "etc",
    "home",
    "library",
    "mnt",
    "nix",
    "opt",
    "private",
    "root",
    "sbin",
    "system",
    "tmp",
    "users",
    "usr",
    "var",
    "volumes",
];

fn windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

fn valid_segment(segment: &str, first: bool, last: bool) -> bool {
    if segment.is_empty() {
        return first || last;
    }
    if segment == "." || segment == ".." {
        return true;
    }
    !segment.ends_with('.')
        && segment
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '@' | '+' | '[' | ']'))
}

/// A file name with an extension: letters first, at most ten characters; one-letter extensions
/// only for the languages that use them.
fn has_extension(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    let shaped = extension.len() <= 10
        && extension.starts_with(|c: char| c.is_ascii_alphabetic())
        && extension.chars().all(|c| c.is_ascii_alphanumeric());
    let long_enough =
        extension.len() >= 2 || matches!(extension, "c" | "h" | "m" | "r" | "s" | "d" | "v");
    shaped && long_enough && (!stem.is_empty() || name.starts_with('.'))
}

/// What a long bare URL shows: no scheme, the host, the first two path segments and the last.
pub(crate) fn short_url(url: &str) -> String {
    let without_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    if without_scheme.chars().count() <= SHORT_URL_CHARS {
        return url.to_owned();
    }
    let path = without_scheme
        .split(['?', '#'])
        .next()
        .unwrap_or(without_scheme);
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some((host, rest)) = segments.split_first() else {
        return url.to_owned();
    };
    let mut shown = (*host).to_owned();
    for segment in rest.iter().take(2) {
        shown.push('/');
        shown.push_str(segment);
    }
    match rest.len() {
        0..=2 => {}
        3 => {
            shown.push('/');
            shown.push_str(rest[2]);
        }
        _ => {
            shown.push_str("/…/");
            shown.push_str(rest[rest.len() - 1]);
        }
    }
    if path.len() < without_scheme.len() {
        shown.push('…');
    }
    if shown.chars().count() > SHORT_URL_CHARS {
        let cut: String = shown.chars().take(SHORT_URL_CHARS - 1).collect();
        return format!("{cut}…");
    }
    shown
}
