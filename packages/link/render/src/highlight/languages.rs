//! Which `@pierre/highlights` language a fence label, file extension, or path names.

use super::generated::{CANONICAL_LANGUAGES, LANGUAGES};

const EXTRA_ALIASES: &[(&str, &str)] = &[
    ("console", "bash"),
    ("terminal", "bash"),
    ("python3", "python"),
    ("py3", "python"),
    ("pyi", "python"),
    ("plist", "xml"),
    ("cfg", "ini"),
    ("conf", "ini"),
    ("typescriptreact", "tsx"),
    ("javascriptreact", "jsx"),
    ("bourne again shell (bash)", "bash"),
    (".env", "dotenv"),
];

const FILENAMES: &[(&str, &str)] = &[
    ("dockerfile", "dockerfile"),
    ("containerfile", "dockerfile"),
    ("makefile", "makefile"),
    ("gnumakefile", "makefile"),
    ("cmakelists.txt", "cmake"),
    ("gemfile", "ruby"),
    ("rakefile", "ruby"),
    ("podfile", "ruby"),
    ("fastfile", "ruby"),
    ("brewfile", "ruby"),
    ("vagrantfile", "ruby"),
    ("justfile", "just"),
    ("jenkinsfile", "groovy"),
    ("cargo.lock", "toml"),
    ("flake.lock", "json"),
    ("go.mod", "go"),
    (".bashrc", "bash"),
    (".zshrc", "bash"),
    (".bash_profile", "bash"),
    (".zprofile", "bash"),
    (".profile", "bash"),
    (".env", "dotenv"),
];

pub(super) fn language_id(language: &str) -> Option<u8> {
    let lower = language.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    let key = EXTRA_ALIASES
        .iter()
        .find(|(alias, _)| *alias == lower)
        .map_or(lower.as_str(), |(_, target)| *target);
    let idx = LANGUAGES
        .binary_search_by_key(&key, |(name, _)| *name)
        .ok()?;
    let id = LANGUAGES[idx].1;
    (id != 0).then_some(id)
}

fn display_name_for_id(id: u8) -> String {
    let canonical = CANONICAL_LANGUAGES
        .get(id as usize)
        .copied()
        .unwrap_or("plain");
    if let Some((_, label)) = LABELS
        .iter()
        .find(|(labels, _)| labels.split(' ').any(|known| known == canonical))
    {
        return (*label).to_owned();
    }
    let mut chars = canonical.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

/// The canonical display name for a fence label such as `ts` or `sh` (`TypeScript`, `Shell`),
/// or `None` when no language knows it. Accepted back by `highlight`.
pub fn normalize_language(label: &str) -> Option<String> {
    language_id(label).map(display_name_for_id)
}

/// The language of a file by its name (`Dockerfile`, `Makefile`) or its extension, as a name
/// `highlight` takes; `None` for a file to show plainly.
pub fn language_for_path(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let lower = name.to_ascii_lowercase();
    if let Some((_, lang)) = FILENAMES.iter().find(|(exact, _)| *exact == lower) {
        return normalize_language(lang);
    }
    if lower.starts_with("dockerfile.") || lower.starts_with("containerfile.") {
        return normalize_language("dockerfile");
    }
    if lower.starts_with(".env.") {
        return normalize_language("dotenv");
    }
    let (_, extension) = name.rsplit_once('.')?;
    normalize_language(extension)
}

/// What a code block's header calls its language: the name people write (`TypeScript`, `Shell`,
/// `C++`) for the labels agents put on fences, else the canonical language name, else the label as
/// written.
pub fn language_label(label: &str) -> String {
    let lower = label.trim().to_ascii_lowercase();
    if let Some((_, name)) = LABELS
        .iter()
        .find(|(labels, _)| labels.split(' ').any(|known| known == lower))
    {
        return (*name).to_owned();
    }
    match normalize_language(label) {
        Some(name) => name,
        None => label.trim().to_owned(),
    }
}

/// Fence labels, space-separated, and the display name each is shown as.
const LABELS: &[(&str, &str)] = &[
    ("ts typescript mts cts", "TypeScript"),
    ("tsx", "TSX"),
    ("js javascript mjs cjs node", "JavaScript"),
    ("jsx", "JSX"),
    ("rs rust", "Rust"),
    ("swift", "Swift"),
    ("kt kts kotlin", "Kotlin"),
    ("py python python3 py3", "Python"),
    (
        "sh bash zsh shell shellscript console shellsession terminal",
        "Shell",
    ),
    ("fish", "Fish"),
    ("ps1 powershell pwsh", "PowerShell"),
    ("json jsonc", "JSON"),
    ("json5", "JSON5"),
    ("jsonl", "JSONL"),
    ("yml yaml", "YAML"),
    ("toml", "TOML"),
    ("md markdown", "Markdown"),
    ("mdx", "MDX"),
    ("go golang", "Go"),
    ("java", "Java"),
    ("c h", "C"),
    ("cpp c++ cc cxx hpp hh", "C++"),
    ("cs csharp", "C#"),
    ("m mm objc objective-c", "Objective-C"),
    ("rb ruby", "Ruby"),
    ("php", "PHP"),
    ("html htm", "HTML"),
    ("xml plist svg", "XML"),
    ("css", "CSS"),
    ("scss", "SCSS"),
    ("sass", "Sass"),
    ("sql", "SQL"),
    ("diff patch", "Diff"),
    ("dockerfile docker containerfile", "Dockerfile"),
    ("makefile make mk", "Makefile"),
    ("groovy gradle", "Groovy"),
    ("txt text plain plaintext", "Text"),
    ("log", "Log"),
    ("output", "Output"),
    ("mermaid", "Mermaid"),
    ("graphql gql", "GraphQL"),
    ("proto protobuf", "Protobuf"),
    ("lua", "Lua"),
    ("dart", "Dart"),
    ("zig", "Zig"),
    ("ex exs elixir", "Elixir"),
    ("hs haskell", "Haskell"),
    ("r", "R"),
    ("ini cfg conf", "INI"),
    ("env dotenv", ".env"),
    ("nix", "Nix"),
    ("vue", "Vue"),
    ("svelte", "Svelte"),
    ("tf hcl terraform", "HCL"),
    ("tex latex", "LaTeX"),
    ("csv", "CSV"),
];
