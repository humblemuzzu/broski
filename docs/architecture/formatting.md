# Formatting — Broski's own formatter

Everything an agent writes (its answers, its thinking, a plan, a subagent's report, a tool's output and
arguments, a notice, a question) reaches the person's eyes through one formatter, the same on iOS and
Android. It is ours: there is no markdown, highlighting-theme or rendering library in the core or
either app, and no WebView.

```
agent text ──► broski-render `format` (Rust: CommonMark 0.31.2 + GitHub's extensions, streaming repair, keys)
           ──► BroskiCore `formatMarkdown(text, streaming) → [FormatBlock]` and the other exports below
           ──► iOS `Sources/Formatting/` · Android `design/format/` (measure and draw only)
```

## The rule

**Every string an agent wrote is drawn through the formatter's views, never a bare `Text`.** On iOS
that is `FormattedText` (a whole text, streaming or not), `FormattedMessage` (the person's message, a
notice, a question: inline styles and fenced code only) or `FormatBlockView` (one block of a lazy
list), and the tool views in `Formatting/Tools/`; on Android the composables of the same names in
`design/format/` and `design/format/tools/`. A fix to how text looks is made there, so it lands on
every screen of both apps.

**The guard.** `scripts/check-agent-text.sh` fails on a `Text(` in either app, outside those
directories, whose argument reads a field agents write (`row.text`, `request.reason`, `tool.output`,
`interaction.body`, …), however it is written: `Text(x.text)`, `Text( x.text)`, `Text(verbatim:
x.text)`, Swift interpolation `Text("…\(x.text)…")`, and Kotlin's `text = x.text` in any position. A
deliberate exception is a line of `scripts/agent-text-allowlist.txt` with why (today: the app's own
problem sentences and names, git's ahead/behind line and hunk header, the Live Activity's count and title,
the work fold's summary, a tool's row label, model and mode names, the person's queued words, the gallery's
Source view). It runs in CI (`agent-text` job) and in the
pre-commit hook when app files are staged. What it cannot see: a value first copied into a local of
another name, a sink other than `Text` (a `Label`, a notification's body), and one-line titles and
labels (an ask's title, an option's label), which are drawn plain on purpose and are not in its list.

## The core: `packages/link/render/src/format/`

```
FormatBlock     { key, containers: [FormatContainer], spacing, direction, content }
FormatContainer { id, kind: Quote | Callout(kind) | Item(list, marker, depth, width) | Footnote(label), first }
FormatContent   = Paragraph(spans) | Heading(level, spans) | Code(FormatCode) | Table(FormatTable)
                | Math(text) | Html(text) | Rule
FormatCode      { language?, file?, text, closed, prose }
FormatSpan      { text, strong, emphasis, strike, code, math, html, link? }
FormatLink      { target, kind: Web | Mail | File(path, line?, column?) | Footnote | Inert, image }
FormatTable     { columns: [TableColumn{align, numeric, short}], header, rows, shape: Grid | KeyValue }
```

- **Parsing.** `block/` builds the CommonMark block tree a line at a time (containers, list items and
  their tight/loose rule, fences, indented code, HTML blocks, setext and ATX headings, link reference
  definitions, GitHub tables); `inline/` runs the delimiter stack (emphasis by the rule of three,
  code spans, links, images, autolinks, entities, raw HTML, `$math$`, footnote references); `flatten`
  turns the tree into blocks in reading order, each carrying the containers it sits in, so both apps
  draw a flat, lazy list.
- **Agent rules on top of the spec** (in `tests/cases.rs`, `links.rs` and `edges.rs`): a path the
  agent put in a code span (`` `src/a.ts:42:7` ``, `` `~/x` ``) becomes a `File` link, but a path in
  prose stays text, since nothing says the file is there and a word drawn as a link must open
  something; a rooted path needs a file name or a system folder at its root, so a route
  (`/api/v1/stt`) is no path; in a log only a path with a line (`src/lib.rs:7`, as a compiler or `grep`
  prints it) is linked. A host named without its scheme
  (`github.com/acme/app/src/auth.ts`, a common top-level domain) is a web link to `https://…`; `*`
  between digits is arithmetic; a closing `$` before a digit, letter or `_` closes no math, so prices
  and `$PATH:$HOME` stay text; `~20ms` is not a strike; `> [!NOTE]` and the
  bold `> **Note**` form are callouts, and Claude's `★ Insight` is an Insight callout; refused schemes
  (`javascript:`, `app:` …) stay text; an image is a chip, never loaded; a URL is shortened for show
  (`github.com/…/ChatMarkdown.tsx`); a table column of numbers is right-aligned in tabular digits; a
  two-column table of short keys is `KeyValue`; a paragraph's direction comes from its first strong
  character.
- **Deliberate differences from the spec**: the 25 examples `tests/spec.rs` lists with reasons are
  one level of the same emphasis inside itself, `2*3*4` as arithmetic, an empty link dropped, an image
  inside a link keeping only the image, and GitHub's tag filter. The test fails if any of the 25 starts
  to pass, so 651 of 676 is the agreed line, not a separate measurement. Two behaviours no spec
  example exercises, and which the test's HTML writer smooths over (bare links and hard breaks are
  normalised on both sides): raw HTML is never run (style pairs like `<b>…</b>` style the text between
  them, `<br>` breaks the line, the rest shows as text), and soft breaks are kept as written.
- **Keys.** A block's `key` is its kind and the byte offset its source starts at. Text appended later
  cannot move an earlier block's start, so while a message streams every block but the last keeps its
  key and content; both apps use the key as the view's identity.
- **Streaming.** `streaming` says more text is coming. Markup still open at the end is closed rather
  than shown as written: open code, open emphasis on the last line, a half-written link destination,
  open brackets; a last line made only of markers (`-`, `#`, `|`, `` ` ``) is held back, as are table
  rows before their delimiter row; open display math counts as math only while streaming.
- **Bounds.** The first `MAX_FORMAT_BYTES` (1 MiB of UTF-8) are parsed; the rest is one plain
  paragraph. The contract bounds a text at 1 Mi *characters*, so a text near that bound in a script of
  three-byte characters (Chinese, Japanese) is formatted for its first third. Nesting is capped; the
  fuzz tests feed random and adversarial input (unclosed `<`, `[`, `[^`, autolinks, thousands of
  addresses, paths and reference definitions, each about a megabyte) and check nothing panics or runs
  long.

### Exports (BroskiCore)

| Export | What it gives |
|---|---|
| `formatMarkdown(text, streaming)` | an agent's text as blocks |
| `formatMessage(text)` | the person's message, a notice, a question: inline styles and fenced code only |
| `formatPlainText(text)` | the plain words (copy as plain text, previews) |
| `tableMarkdown` / `tableCsv` / `tableTsv` / `tableHtml(table)` | a table's exports (copy, share; TSV and HTML go on the pasteboard together) |
| `formatJson(text)` | JSON pretty-printed and coloured, or nothing |
| `languageLabel(label)` | a fence's info string as a name (`ts` → TypeScript) |
| `toolBody(facts, output)` | how a result reads when its tool has no display: `Markdown`, `FileText`, `Matches`, `Json`, `Log` |
| `toolArguments(facts)` | a call's input as a property list: inline, block, markdown (folded), tree |
| `formatLog(text, maxLines, keep)` | a log's lines with its links and its paths that name a line, clipped at the head or tail, and how many are hidden |
| `formatSamples()` | the gallery's corpus, each with `arriving` when it stops mid-message |

The bridge fills two typed displays beside `todos`, `links` and `files`: `markdown` (subagent reports,
fetched pages) and `file_text { path, firstLine, text, note? }` (reads, by both agents). `toolBody`'s
sniffing is only the fallback for MCP and unknown tools.

## The apps

| | iOS (`apps/ios/Broski/Sources/Formatting/`) | Android (`design/format/`) |
|---|---|---|
| Tokens (sizes, spacing, link blue, callout tints) | `FormatTokens.swift` | `FormatTokens.kt` |
| Spans, links | `FormatSpans`, `FormatLinks` (Safari view, Mail, Files at a line) | `FormatSpans.kt` (Custom Tabs, Files at a line) |
| A whole text / a message / one block | `FormattedText`, `FormattedMessage`, `FormatBlockView` | the same names |
| Quotes, callouts, list gutters, footnotes | `FormatContainers.swift` | `FormatContainers.kt` |
| Code: header, wrap, copy, expand, fold at 30 lines, diffs, `$` prompts | `FormatCodeBlock.swift`, `CodeViewer.swift` | `FormatCodeBlock.kt`, `CodeViewer.kt` |
| Tables: fitting, fold at 12 rows, copy, viewer with Rows | `TableLayout`, `FormatTableView`, `TableViewer` | `TableLayout.kt`, `FormatTable.kt`, `TableViewer.kt` |
| Long-press: the block's links (open, copy), Copy, Copy as plain text, Select Text, Share | `AnswerMenu.swift` | `AnswerMenu.kt` |
| Tool bodies, logs, command line, arguments | `Tools/` | `tools/` |
| Settings › Reading | `ReadingSettings.swift`, `Features/Settings/ReadingSettingsScreen.swift` | `LocalReading` in `FormatTokens.kt`, `feature/settings/ReadingSheet.kt` |
| Gallery | `FormattingGalleryScreen` | `FormattingGallery` sheet (`feature/settings/`) |

- **Roles.** `page` for what the person reads (17 pt / 16 sp body), `quiet` for what sits under a row
  (thinking, a subagent's or an activity's text, a card's body).
- **Spacing** comes from the core's `FormatSpacing` step between blocks, scaled by the reader's
  density: `Tight` 8 (items of a list written without blank lines), `Loose` 14, `AfterGroup` 14 (the
  item after one that holds a nested list or a second paragraph, or runs past about two lines, so the
  points of a tight list read apart), `AfterHeading` 10, `Paragraph` 16, `Section` 28 (before a heading, and after a rule, a code
  block or a table). A rule draws nothing: the space around it is the separation.
- **Text colour.** An answer's running text is the text colour at 86 %, so long reading does not
  glare; bold is semibold at 94 %, found when scanning without pulling the eye while reading; headings are at full strength.
- **Headings** 24 / 21 / 18 pt (iOS, scaling with Dynamic Type) and 23 / 20 / 17 sp, H4–H6 at body
  size in the secondary colour.
- **Inline code** is 0.88 of the text, medium weight, on a rounded fill of the text's own colour at
  6 % (light) or 11 % (dark): `ChipRenderer` (a SwiftUI `TextRenderer`) and `SpanText` (Compose,
  drawn behind the text from its layout) draw the fills under the glyphs. A path in code that opens a
  file is drawn in its own colour (teal, `FormatTokens.path`) with no fill, never link blue; where the
  text belongs to no machine it is plain code. Only pages and addresses are blue; a page named by a
  title starts with a small globe.
- **Bleed.** A code block or a table at the top level of an answer reaches across the screen's side
  margin (`formatBleed` / `LocalFormatBleed`, set by the transcript, the text page and the gallery):
  code on a full-width band with its text still in line with the prose, a table with its hairlines to
  the edges and its first column's text where the prose starts. Inside a list, a quote, a callout, a
  quiet row or a bubble they keep to their column.
- **Code blocks** have a quiet header: the language, the file name, the line count past ten, Copy and
  Expand. On iOS Wrap is in the long-press menu; on Android, whose code is selectable (so a long-press
  selects), it stays in the header.
- **Sources.** Under a finished answer, the pages its turn's searches found (`links` displays), each
  once, as rows of title and site, four shown and the rest a tap away (`SourcesList`).
- **Tables** are drawn open, without a card: the header in the secondary colour, hairlines above and
  below it and under every row. They fit in three tiers: natural widths when they fit; else each column at least its longest
  word (56–200 pt) with the rest shared out and cells wrapping; else columns capped and the table
  scrolls sideways, its short first column held still and its end edge fading while more columns are
  past it. Widths are measured in the fonts the cells are drawn in (tabular digits, monospaced code)
  and kept per table, width and text size; while streaming they only grow. The viewer lays the table
  out again only when a pinch ends; during it, what is drawn is scaled.
- **Settings › Reading**: text size on top of the system's (−2…+3 steps), comfortable or compact
  density, code wraps by default, links underlined.
- **The transcript** makes one row per block, so a long answer stays lazy and only its last block
  redraws while it streams; a new text row fades in over 150 ms (none with Reduce Motion).
- **Selection.** iOS selects through the long-press menu's Select Text sheet (the whole answer, plain
  text) rather than per-block `textSelection`, which cannot cross blocks; Android the same.

## Tests and numbers

- `cargo test -p broski-render`: 73 tests, among them every CommonMark 0.31.2 and GFM 0.29
  extension example (651 of 676 pass; the 25 others are the deliberate differences above, each named
  in `tests/spec.rs`), the agent rules (`cases.rs`), streaming (every prefix of every sample keeps the
  earlier blocks' keys and content), fuzzing, the exports, `toolBody`, `toolArguments` and `formatLog`.
- `mobile/tests/render.rs`, `RenderTests.swift` and `RenderTest.kt` call the exports from Rust, Swift
  and Kotlin.
- The caches: each app keeps finished texts' blocks (up to 2,000 texts or 16 Mi characters) apart
  from streaming ones (the last 16), since every batch of a streaming answer is a new text never asked
  for again.
- `cargo run --release -p broski-render --example bench` (Apple M-series, release): a 20,000-character
  message 0.34 ms, the same while it streams 0.35 ms, a 1,000,000-character text 19.5 ms.
- iOS `ChatPerformanceTests`: rebuilding the rows of a 1,000-item run with a growing answer takes
  0.098 s for 30 batches, about 3 ms a batch.
- iOS `TableWidthTests`: a page of tables in a real window stays exactly the window's width (a table
  at fixed column widths once held the page wider and cut every paragraph at the left).
- `UITests/SettingsFormattingEndToEndTests` photographs every sample in light and dark, the default
  size and AX3, the table viewer and an expanded code block
  (`TEST_RUNNER_BROSKI_GALLERY_QUICK=1` for light, default, upright only). It asks for sideways
  shots too, but the iPhone Duo simulator (the only phone the iOS 27.1 runtime offers) stays upright,
  so its `landscape` files are upright frames: iOS has no sideways proof. On Android,
  `androidTest/.../feature/format/FormattingShots` photographs every sample at font scale 1 and 2,
  light and dark, upright and sideways (turned before anything is drawn, since turning recreates the
  activity), into `/sdcard/broski-shots/formatting`.
