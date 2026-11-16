# Rendering — `broski-render`

Crate `packages/link/render` (`broski-render`). What the iOS and Android apps must draw identically,
computed once in Rust and exported through BroskiCore ([mobile-packaging.md](mobile-packaging.md)):
assistant markdown as blocks, code as lines of coloured spans, and diffs as files, hunks and lines with
the changed words marked. Swift and Kotlin only map the records to `AttributedString` /
`AnnotatedString` and pick colours from their own light and dark palettes. Like `broski-client`, the
crate has no UniFFI dependency; the facade restates its types with `#[uniffi::remote]`
(`mobile/src/render.rs`).

Every function is pure, synchronous and bounded. None needs a `Phone`. For a large file or diff, call
it off the main thread (a Swift `Task.detached`, Kotlin `Dispatchers.Default`).

## Markdown

`markdownBlocks(text) → [MarkdownBlock]`, on pulldown-cmark 0.13.6: CommonMark with GitHub's
tables, strikethrough (`~a~`, `~~a~~`) and task lists. Autolinks are CommonMark's (`<https://…>`); a bare
URL stays text (pulldown-cmark has no GFM extended autolinks). Not enabled: footnotes, math, heading
attributes, metadata blocks, GitHub's `[!NOTE]` quote kinds (their marker shows as written).

The result is **flat**, so a `ForEach` / `LazyColumn` lays it out with no recursion (UniFFI 0.32 has
recursive enums, but a tree would make both apps walk it):

```
MarkdownBlock { key, containers: [BlockContainer], content: BlockContent }
BlockContainer = Quote | ListItem { marker: Bullet | Number{value} | Task{checked}, first }
BlockContent   = Paragraph{runs} | Heading{level 1–6, runs} | Code{language?, text}
               | Table{alignments: [Leading|Center|Trailing], header: TableRow, rows: [TableRow]}
               | Rule | Html{text}
TableRow { cells: [TableCell{runs}] }
InlineRun { text, strong, emphasis, strikethrough, code, link? }
```

- `containers` are the quotes and list items around the block, outermost first: indent one step per
  container, draw a quote bar per `Quote`, and a list marker for a `ListItem` whose `first` is true (the
  item's later blocks hang under it). `- - x` gives one block with two first items: both markers on one
  line. Ordered lists count from their start; a task item's marker replaces its bullet or number.
- Inline runs are already merged: neighbours always differ in style. A soft line break is a space (as
  CommonMark renders it), a hard one `\n`; an image is its alt text linking to its URL; inline HTML is
  literal text, and so is an HTML block (`Html`).
- A `link` is kept only for `http://`, `https://` and `mailto:` (the scheme in any case). The text comes
  from a model, so a destination that would start an app (`tel:`, `intent://`, `file:`, `broski://pair`,
  `javascript:`) or is relative leaves its label as plain text. Both apps open `link` as given and
  linkify nothing themselves.
- `Code.language` is the fence's first word as written (`ts`), the label to show and the argument to
  `highlight`. The block's text has no trailing newline. An unclosed fence (a message still streaming)
  is a code block to the end of the text.
- **Keys.** A block's `key` is its kind and the byte offset its source starts at (`p-48`, `code-59`).
  Text appended later cannot move an earlier block's start, so while the chat parses the open text
  block again on every batch (≤ 30 a second), every block but the last keeps its key. Only the last
  block's content changes, and the one before it when the new text joins it (a table's next row, a
  paragraph's lazy continuation line), which briefly read as a block of their own. Use the key as the
  SwiftUI / Compose identity: only the last block redraws. A setext underline or a table's delimiter
  row changes the kind, and so the key, of the block it completes: it is a different block.
- **Code blocks are not highlighted here**: the app calls `highlight(code, language)` once per block key
  and text (an `Equatable` view, `remember(text, language)`), so a streaming message does not colour its
  earlier code again on every batch.
- **Bounds.** The first `MAX_MARKDOWN_BYTES` (1 MiB, the contract's `MAX_TEXT_CHARS`) are parsed; the
  rest is one plain paragraph keyed `rest-<offset>`. At most `MAX_CONTAINER_DEPTH` (16) containers are
  listed per block; deeper ones are left out of its path, its text is kept.
- **Cost** (`cargo run --release -p broski-render --example bench`, Apple M-series): a 20,000-character
  agent message of headings, lists, tables, code and links (400 blocks) parses in **0.24 ms**, so 30
  batches a second of a message that long cost about 7 ms a second.

## Highlighting

`highlight(code, language?) → [CodeLine { spans: [CodeSpan { text, kind: TokenKind }] }]`, one line
per line of `code` without its break; an empty line has no span. `TokenKind` is `plain, comment,
keyword, string, number, constant, type, function, variable, property, operator, punctuation, tag,
attribute, inserted, deleted, heading`: each app colours the kinds by its own palette.

- `languageForPath(path) → String?` names a file's language by its name (`Dockerfile`, `Makefile`) or
  extension; `nil` means plain text. `normalizeLanguage(label) → String?` names a fence label's
  language (`ts` → `TypeScript`, `sh`/`zsh`/`shell` → `Bourne Again Shell (bash)`). `highlight` takes
  either a label, an extension or a name either returned. Unknown, `text`, or absent: every line is
  one plain span.
- **Engine.** syntect 5.3.0, parsing only (no themes), with the pure-Rust fancy-regex engine (no
  Oniguruma C library to cross-compile). A span takes the kind of the innermost TextMate scope a rule
  names (`highlight/kinds.rs`), except that anything inside a comment is a comment and anything inside a
  mapping key (JSON, YAML) a property.
- **Grammars.** Bash, C, C++, C#, CSS, Dart, Diff, Dockerfile, Go, Groovy, HTML, Java, JavaScript, JSON,
  Kotlin, Lua, Makefile, Markdown, Objective-C, Python, Ruby, Rust, SQL, Swift, TOML, TypeScript, TSX,
  XML and YAML: the Sublime Text syntaxes of bat v0.26.1 (the curation two-face 0.5.2 ships), vendored
  with their licenses in `render/syntaxes/` (its README lists the sources and commits) and compiled by
  `build.rs` into a 0.26 MB dump loaded once on first use. A language one of them embeds that is not
  in the set (a fenced block in Markdown) shows as plain text.
- **Bounds**, by size and never by a clock (a clock would colour the same file differently on a cold
  start): at most `MAX_HIGHLIGHT_LINES` (5,000) lines and `MAX_HIGHLIGHT_BYTES` (512 KiB); a line longer
  than `MAX_HIGHLIGHT_LINE_BYTES` (4 KiB, as Sublime Text itself) or a grammar error stops the
  colouring; every line from there on is plain. A regex that would backtrack without end cannot hang a
  line: fancy-regex gives up after a million steps, which syntect takes as no match.
- **Cost** (same bench): loading the grammars and compiling Rust's on first use 18 ms, TypeScript's
  89 ms on its first use; then 2,136 lines of Rust in 97 ms (about 22,000 lines a second; expect a
  phone to be two to three times slower).

### Why syntect with a curated set

| Option | Arm64 Android `.so`, stripped | Verdict |
|---|---|---|
| syntect + two-face's whole dump (bat's ~200 grammars) | +3.13 MB for the whole crate, 0.94 MB of it the dump | over the 3 MB budget |
| syntect + syntect's own defaults | the dump about 0.36 MB | no TypeScript, TSX, Kotlin, Swift, TOML or Dockerfile |
| tree-sitter grammars | each grammar is a generated C parse table: tree-sitter-typescript 0.23.2's `parser.c` is 8.7 MB of source for TypeScript and 8.8 MB for TSX (compiled size not measured) | not tried: about 30 such grammars |
| **syntect + the vendored subset** | **+2.43 MB for the whole crate, 0.26 MB of it the dump** | chosen |

A syntect `SyntaxSet` cannot be cut down after it is built (its contexts reference each other by
index), so the subset is compiled from the grammar sources.

## Diffs

```
ParsedDiff { files: [DiffFile], truncated }
DiffFile   { path, previousPath?, change: GitChange, binary, hunks: [DiffHunk], additions, deletions }
DiffHunk   { oldStart, oldLines, newStart, newLines, header?, lines: [DiffLine] }
DiffLine   { kind: context|added|removed|noNewline, oldLine?, newLine?, text, segments: [DiffSegment] }
DiffSegment { text, emphasized }
SideBySideRow { left?: DiffLine, right?: DiffLine }
```

- `parseUnifiedDiff(text)` reads `git diff` output (renames, copies, new and deleted files, mode lines,
  `Binary files … differ`, `GIT binary patch` data skipped), `diff -u` output (its tab and timestamp
  are not part of the path), and bare hunks with no file header (one file with an empty path). A hunk's
  line counts say where its body ends, so a removed line that reads `--- x` is a line, not a header.
- `fileChangeDiff(change)` takes a tool's `FileChange` (a `ToolResult`'s or a permission preview's
  `fileChanges`): its path, previous path and kind, and the hunks of its `diff`; without a `diff` it has
  no hunks and the change's own counts.
- `gitDiffFile(file)` takes one file of a `git.diff` answer, already parsed by the bridge, and adds the
  `noNewline` marker lines and the word emphasis.
- `\ No newline at end of file` is a `noNewline` line about the line before it, with no numbers.
- **Emphasis.** A run of removed lines followed by a run of added lines is a modification; its lines
  pair up in order (across a `noNewline` marker) and each pair is diffed by tokens (words, whitespace
  runs, and each other character alone), so `let count = 1;` → `let count = 2;` marks the `1`. A pair
  with less than 40 % of its visible text in common was rewritten, not edited, and gets no emphasis;
  so does a line over `MAX_EMPHASIS_LINE_BYTES` (1,000). `segments` is empty when nothing in the line is
  emphasized; otherwise its texts join to `text`. Segments rather than ranges: Swift's string indices
  and Kotlin's UTF-16 offsets would each need a conversion that a segment does not.
- `sideBySide(hunk)` gives rows for a wide screen: context on both sides, a modification's lines side by
  side in order, the longer run's extra lines against an empty side.
- **Bounds.** The first `MAX_DIFF_BYTES` (1 MiB) and `MAX_DIFF_LINES` (20,000) hunk lines, the
  contract's bounds; past either, `truncated`. Each pair's token diff gets 5 ms before similar settles
  for a coarser diff. **Cost**: 15,000 lines of `git diff` with emphasis parse in 1.4 ms.

## Tool calls in the work fold

`toolLook(facts) → ToolLook` and `foldCounts(tools) → [FoldCount]` (`work/`), so both apps read a call and
count a stretch of work the same way. They live here, not in the client, because they are how a call is
*drawn*: pure functions of one call's facts, with no session state.

- `ToolFacts { name, title?, input?, hasChildSession, changedPaths }` in; `ToolLook { kind, label, verb,
  command?, paths }` out. **Kind** is by the lower-cased name (`bash`, `Bash`, `killshell`, `str_replace`,
  `write_file`, `toolsearch`, `browse` … the lists are in `work/mod.rs`), except that a call with a child
  session is an `Agent` and one with changed files an `Edit`; anything else, an MCP tool included, is
  `Other`.
- **Label** is the backend's title (first line), else what the call acted on: a command's first line,
  `Read main.rs`, `Edited a.md` (the file's name), `Searched TODO`, a URL or query, a subagent's
  description, `<tool> <path or query>`; the tool's name when the input says nothing. **`verb`** is what
  the row says instead while it is open (`Ran command`, `Read file`), because the detail then shows the
  command or the arguments the label was made from. **`command`** is a command tool's command whole
  (`command`, `cmd` or `script`).
- `FoldTool { id, kind, paths }` for each of the stretch's own calls (not a subagent's) gives at most two
  verbs of `Edited, Ran, Read, Searched, Fetched, Delegated, Used`, most consequential first, the rest
  folded into `Used`. Files count once however often they are read or edited, an edited file is not
  also read, and a call that names no file counts as one. The apps write the sentence ("Ran 2 commands")
  and the time.
- The form logic is the contract crate's (`form_field_shown`, `form_field_default`), the phone's reading of
  `field-check.ts`' `fieldIsActive`.

## Activities and long text

`activityLook(activity) → ActivityLook` (`activity.rs`) and `clipText(text, maxLines, keep) → TextClip`,
`formatDuration(ms)` (`text.rs`), so both apps draw what is not a turn, and every long text, the same way.

- `ActivityLook { tone, facts, preview?, log?, opens }`: **tone** is `Failed` for a failed status or a
  non-zero exit, `Working` for one that reported in and goes on, else `Plain`; **facts** are the duration
  (from a second up) and a failed exit (`1h 5m`, `Exit 1`); **preview** is a markdown or text body's opening
  words on one line (`plainPreview`, at most 240 characters); **log** is a log body's last 12 lines; **opens**
  says there is a command, a body or a session to open.
- `clipText` keeps at most `maxLines` lines from the head or the tail, within 16 KiB whatever the lines (a
  minified line can be a megabyte), cut at a line break where there is one, and says how many lines it left
  out. Nothing in the chat draws a tool's output, a log or a notice whole: it draws a clip and opens the
  rest on a screen or sheet of its own.
- `formatDuration` words a duration as the work fold does: `12s`, `2m`, `1h 5m`.

## Tests

`cargo test -p broski-render`: every tool name either app ever listed, in three spellings, with each
label, the command and the fold's counts (`work/tests.rs`); a table of agent-style messages and their block shapes, CommonMark spec
examples, nested lists, task lists loose and tight, quotes, tables, inline styles and links, the bounds,
and a message streamed one character at a time whose earlier blocks keep their keys and content
(`markdown/tests.rs`); token kinds in 18 languages, labels and paths, unknown languages and the bounds
(`highlight/tests.rs`); real `git diff` output (multi-file, rename, binary, new, deleted, no newline at
the end), a `GIT binary patch`, `diff -u` output, the fake backend's `EDIT`, header-like body lines, a
contract `FileChange` and `GitDiffFile`, emphasis, side-by-side rows and the line bound
(`diff/tests.rs`, fixtures in `render/tests/fixtures`). `mobile/tests/render.rs` calls every export;
`apps/ios/BroskiCore` (`RenderTests.swift`) and `apps/android/core` (`RenderTest.kt`) call them from
Swift and Kotlin.
