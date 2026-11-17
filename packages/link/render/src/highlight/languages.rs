//! Which grammar a fence label, a file extension or a path names.

use syntect::parsing::{SyntaxReference, SyntaxSet};

use super::syntaxes;

/// Labels agents write that the grammars know by another name. Everything else is looked up as
/// an extension, then as a grammar's name, ignoring case.
const ALIASES: &[(&str, &str)] = &[
    ("shell", "bash"),
    ("console", "bash"),
    ("shellsession", "bash"),
    ("golang", "go"),
    ("c++", "cpp"),
    ("objc", "m"),
    ("python3", "py"),
    ("jsonc", "json"),
    ("json5", "json"),
    ("docker", "dockerfile"),
];

const PLAIN: &[&str] = &["text", "txt", "plain", "plaintext"];

pub(super) fn syntax_for<'a>(
    syntaxes: &'a SyntaxSet,
    language: &str,
) -> Option<&'a SyntaxReference> {
    let label = language.trim().to_ascii_lowercase();
    if label.is_empty() || PLAIN.contains(&label.as_str()) {
        return None;
    }
    let token = ALIASES
        .iter()
        .find(|(alias, _)| *alias == label)
        .map_or(label.as_str(), |(_, token)| token);
    let found = syntaxes
        .find_syntax_by_token(token)
        .or_else(|| syntaxes.find_syntax_by_name(language.trim()))?;
    let plain = syntaxes.find_syntax_plain_text();
    (found.name != plain.name).then_some(found)
}

/// The grammar's name for a fence label such as `ts` or `sh` (`TypeScript`, `Bourne Again Shell
/// (bash)`), or `None` when no grammar knows it.
pub fn normalize_language(label: &str) -> Option<String> {
    syntax_for(syntaxes(), label).map(|syntax| syntax.name.clone())
}

/// The language of a file by its name (`Dockerfile`, `Makefile`) or its extension, as a name
/// `highlight` takes; `None` for a file to show plainly.
pub fn language_for_path(path: &str) -> Option<String> {
    let syntaxes = syntaxes();
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let by_name = syntaxes.find_syntax_by_extension(name);
    let by_extension = || {
        let (_, extension) = name.rsplit_once('.')?;
        syntaxes.find_syntax_by_extension(extension)
    };
    let found = by_name.or_else(by_extension)?;
    let plain = syntaxes.find_syntax_plain_text();
    (found.name != plain.name).then(|| found.name.clone())
}

/// What a code block's header calls its language: the name people write (`TypeScript`, `Shell`,
/// `C++`) for the labels agents put on fences, else the grammar's name without its aside, else the
/// label as written.
pub fn language_label(label: &str) -> String {
    let lower = label.trim().to_ascii_lowercase();
    if let Some((_, name)) = LABELS
        .iter()
        .find(|(labels, _)| labels.split(' ').any(|known| known == lower))
    {
        return (*name).to_owned();
    }
    match normalize_language(label) {
        Some(name) => name.split(" (").next().unwrap_or(&name).to_owned(),
        None => label.trim().to_owned(),
    }
}

/// Fence labels, space-separated, and the name each is shown as.
const LABELS: &[(&str, &str)] = &[
    ("ts typescript mts cts", "TypeScript"),
    ("tsx", "TSX"),
    ("js javascript mjs cjs node", "JavaScript"),
    ("jsx", "JSX"),
    ("rs rust", "Rust"),
    ("swift", "Swift"),
    ("kt kts kotlin", "Kotlin"),
    ("py python python3 py3", "Python"),
    ("sh bash zsh shell console shellsession terminal", "Shell"),
    ("fish", "Fish"),
    ("ps1 powershell pwsh", "PowerShell"),
    ("json jsonc json5 jsonl", "JSON"),
    ("yml yaml", "YAML"),
    ("toml", "TOML"),
    ("md markdown mdx", "Markdown"),
    ("go golang", "Go"),
    ("java", "Java"),
    ("c h", "C"),
    ("cpp c++ cc cxx hpp hh", "C++"),
    ("cs csharp", "C#"),
    ("m objc objective-c", "Objective-C"),
    ("rb ruby", "Ruby"),
    ("php", "PHP"),
    ("html htm", "HTML"),
    ("xml plist svg", "XML"),
    ("css", "CSS"),
    ("scss sass", "SCSS"),
    ("sql", "SQL"),
    ("diff patch", "Diff"),
    ("dockerfile docker containerfile", "Dockerfile"),
    ("makefile make mk", "Makefile"),
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
