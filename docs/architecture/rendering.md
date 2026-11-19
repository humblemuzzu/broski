# Rendering — `broski-render`

Crate `packages/link/render` (`broski-render`). What the iOS and Android apps must draw identically,
computed once in Rust and exported through BroskiCore ([mobile-packaging.md](mobile-packaging.md)):
code as lines of coloured spans, and diffs as files, hunks and lines with the changed words marked.
The agent's markdown goes through the crate's formatter, documented on its own in
[formatting.md](formatting.md). Swift and Kotlin only map the records to `AttributedString` /
`AnnotatedString` and pick colours from their own light and dark palettes. Like `broski-client`, the
crate has no UniFFI dependency; the facade restates its types with `#[uniffi::remote]`
(`mobile/src/render.rs`).

Every function is pure, synchronous and bounded. None needs a `Phone`. For a large file or diff, call
it off the main thread (a Swift `Task.detached`, Kotlin `Dispatchers.Default`).

## Highlighting

`highlight(code, language?) → [CodeLine { spans: [CodeSpan { text, kind: TokenKind }] }]`, one line
per line of `code` without its break; an empty line has no span. `TokenKind` is `plain, comment,
keyword, string, number, constant, type, function, variable, property, operator, punctuation, tag,
attribute, inserted, deleted, heading`: each app colours the kinds by its own palette.

- `languageForPath(path) → String?` names a file's language by its name (`Dockerfile`, `Makefile`) or
  extension; `nil` means plain text. `normalizeLanguage(label) → String?` names a fence label's
  language (`ts` → `TypeScript`, `sh`/`zsh`/`shell` → `Shell`). `highlight` takes either a label, an
  extension, or a name either returned. Unknown, `text`, or absent: every line is one plain span.
- **Engine.** `@pierre/highlights` 0.5.1 (Apache-2.0), written in WebAssembly Text and compiled to C
  by WABT's `wasm2c` 1.0.42 (`scripts/generate-highlights.sh`). The generated C, the small `wasm2c`
  runtime, and SIMDe's amalgamated `wasm/simd128.h` live in `render/vendor/highlights/` and are
  compiled by `build.rs` with plain `malloc` memory and explicit bounds checks (no guard-page signal
  handlers fighting iOS/Android crash reporters). The engine runs in mode 3 (UTF-16 token records, no
  themes), behind one mutex; `kinds.rs` maps Pierre's token IDs onto our 17 `TokenKind`s.
- **Languages.** 152 languages built in (348 names and aliases in `highlight/generated.rs`), covering
  every language agents meet with no grammar downloads or runtime parsing.
- **Bounds**, by size and never by a clock (a clock would colour the same file differently on a cold
  start): at most `MAX_HIGHLIGHT_LINES` (5,000) lines and `MAX_HIGHLIGHT_BYTES` (512 KiB); a line longer
  than `MAX_HIGHLIGHT_LINE_BYTES` (4 KiB) stops the colouring; every line from that point on is plain.
  If the Wasm module traps or fails to grow memory, the instance resets and the file renders plain;
  after any large input (> 8 MiB of Wasm memory) the next small call resets the instance to release it.
- **Cost** (same bench): first-use instance init + Rust 0.96 ms, first TypeScript call 51 µs; then
  2,280 lines of Rust in 2.29 ms (about 1,000,000 lines a second; ~42× faster than syntect on Rust
  and ~300× faster on TypeScript, with 152 languages instead of 28).

### Why `@pierre/highlights` via `wasm2c`

| Option | Native arm64 cost | Verdict |
|---|---|---|
| syntect + two-face's whole dump (~200 grammars) | +3.13 MB for the whole crate, 0.94 MB dump | over budget and slow |
| syntect + curated 28-grammar subset | ~1.05 MB (regex engine + 0.26 MB dump), 97 ms / 2.1k lines of Rust, 546 ms / 2.9k lines of TS | previously used; slow on phones |
| tree-sitter grammars | 8+ MB of generated C per language (TS + TSX alone ~17 MB of source) | too large for mobile |
| **`@pierre/highlights` via `wasm2c`** | **~0.86 MB (`-O2`) for 152 languages, 2.29 ms / 2.3k lines of Rust, 1.85 ms / 2.9k lines of TS** | **chosen** |

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
- **A call opened** reads through three more (`work/arguments.rs`, `work/body.rs`):
  `toolArguments(facts)` is the input as a property list (short values inline, long ones as a block,
  a markdown value such as a subagent's prompt to format and fold, nested objects as a tree);
  `toolBody(facts, output)` is how a result with no display of its own reads (`Markdown`, `FileText` from
  Claude's `cat -n` lines, `Matches` as `path:line` rows, `Json` pretty-printed and coloured, else
  `Log`, its last `TOOL_LOG_LINES` 200 lines); `formatLog(text, maxLines, keep)` is a log's lines with
  their URLs and paths as links and how many were left out.

## Activities and long text

`activityLook(activity) → ActivityLook` (`activity.rs`) and `clipText(text, maxLines, keep) → TextClip`,
`formatDuration(ms)` (`text.rs`), so both apps draw what is not a turn, and every long text, the same way.

- `ActivityLook { tone, facts, preview?, log?, opens }`: **tone** is `Failed` for a failed status or a
  non-zero exit, `Working` for one that reported in and goes on, else `Plain`; **facts** are the duration
  (from a second up) and a failed exit (`1h 5m`, `Exit 1`); **preview** is a text body's opening words on
  one line (`openingWords`, at most 240 characters); **log** is a log body's last 12 lines; **opens**
  says there is a command, a body or a session to open.
- `clipText` keeps at most `maxLines` lines from the head or the tail, within 16 KiB whatever the lines (a
  minified line can be a megabyte), cut at a line break where there is one, and says how many lines it left
  out. Nothing in the chat draws a tool's output, a log or a notice whole: it draws a clip and opens the
  rest on a screen or sheet of its own.
- `formatDuration` words a duration as the work fold does: `12s`, `2m`, `1h 5m`.

## Tests

`cargo test -p broski-render`: every tool name either app ever listed, in three spellings, with each
label, the command and the fold's counts (`work/tests.rs`); token kinds in 18 languages, labels and paths, unknown languages and the bounds
(`highlight/tests.rs`); real `git diff` output (multi-file, rename, binary, new, deleted, no newline at
the end), a `GIT binary patch`, `diff -u` output, the fake backend's `EDIT`, header-like body lines, a
contract `FileChange` and `GitDiffFile`, emphasis, side-by-side rows and the line bound
(`diff/tests.rs`, fixtures in `render/tests/fixtures`). `mobile/tests/render.rs` calls every export;
`apps/ios/BroskiCore` (`RenderTests.swift`) and `apps/android/core` (`RenderTest.kt`) call them from
Swift and Kotlin.
