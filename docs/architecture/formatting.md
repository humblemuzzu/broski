# Formatting — Broski's own formatter

Everything an agent writes (its answers, its thinking, a plan, a subagent's report, a tool's output and
arguments, a notice, a question) reaches the person's eyes through one formatter, the same on iOS and
Android. It is ours: there is no markdown, highlighting-theme or rendering library in the core or
either app, and no WebView. The design it was built to is
[`docs/rebuild/formatting-plan.md`](../rebuild/formatting-plan.md).

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
`interaction.body`, …). A deliberate exception is a line of `scripts/agent-text-allowlist.txt` with
why (today: the app's own problem sentences, git's ahead/behind line, the Live Activity's count, the
person's queued words, the gallery's Source view). It runs in CI (`agent-text` job) and in the
pre-commit hook when app files are staged. It reads the field where it is drawn: a value first copied
into a local of another name passes, so it catches the direct slip, not every path.

## The core: `packages/link/render/src/format/`

```
FormatBlock     { key, containers: [FormatContainer], spacing, direction, content }
FormatContainer { key, kind: Quote | Callout(kind, title?) | Item(marker, depth) | Footnote(label) }
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
- **Agent rules on top of the spec** (each in `tests/cases.rs`): a bare path (`src/a.ts:42:7`, `~/x`)
  becomes a `File` link; `*` between digits is arithmetic; `~20ms` is not a strike; `> [!NOTE]` and the
  bold `> **Note**` form are callouts, and Claude's `★ Insight` is an Insight callout; refused schemes
  (`javascript:`, `app:` …) stay text; an image is a chip, never loaded; a URL is shortened for show
  (`github.com/…/ChatMarkdown.tsx`); a table column of numbers is right-aligned in tabular digits; a
  two-column table of short keys is `KeyValue`; a paragraph's direction comes from its first strong
  character.
- **Deliberate differences from the spec** (the 25 examples `tests/spec.rs` lists with reasons): one
  level of the same emphasis inside itself; `2*3*4` is arithmetic; an empty link is dropped; an image
  inside a link keeps only the image; raw HTML is never run (style pairs like `<b>…</b>` style the text
  between them, `<br>` breaks the line, the rest shows as text); soft breaks are kept as written.
- **Keys.** A block's `key` is its kind and the byte offset its source starts at. Text appended later
  cannot move an earlier block's start, so while a message streams every block but the last keeps its
  key and content; both apps use the key as the view's identity.
- **Streaming.** `streaming` says more text is coming. Markup still open at the end is closed rather
  than shown as written: open code, open emphasis on the last line, a half-written link destination,
  open brackets; a last line made only of markers (`-`, `#`, `|`, `` ` ``) is held back, as are table
  rows before their delimiter row; open display math counts as math only while streaming.
- **Bounds.** The first `MAX_FORMAT_BYTES` (1 MiB, the contract's `MAX_TEXT_CHARS`) are parsed; the
  rest is one plain paragraph. Nesting is capped; the fuzz tests feed random and adversarial input and
  check nothing panics or runs long.

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
| `formatLog(text, maxLines, keep)` | a log's lines with links and paths, clipped at the head or tail, and how many are hidden |
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
| Long-press: Copy, Copy as Markdown, Select Text, Share | `AnswerMenu.swift` | `AnswerMenu.kt` |
| Tool bodies, logs, command line, arguments | `Tools/` | `tools/` |
| Settings › Reading | `ReadingSettings.swift`, `Features/Settings/ReadingSettingsScreen.swift` | `LocalReading` in `FormatTokens.kt`, `feature/settings/ReadingSheet.kt` |
| Gallery | `FormattingGalleryScreen` | `FormattingGallery` sheet (`feature/settings/`) |

- **Roles.** `page` for what the person reads (17 pt / 16 sp body), `quiet` for what sits under a row
  (thinking, a subagent's or an activity's text, a card's body).
- **Spacing** comes from the core's `FormatSpacing` step between blocks (`None`, `Tight`, `Loose`,
  `AfterHeading`, `Paragraph`, `Section`), scaled by the reader's density.
- **Tables** fit in three tiers: natural widths when they fit; else each column at least its longest
  word (56–200 pt) with the rest shared out and cells wrapping; else columns capped and the table
  scrolls sideways, its short first column held still. Widths are measured in the fonts the cells are
  drawn in (tabular digits, monospaced code); while streaming they only grow.
- **Settings › Reading**: text size on top of the system's (−2…+3 steps), comfortable or compact
  density, code wraps by default, links underlined.
- **The transcript** makes one row per block, so a long answer stays lazy and only its last block
  redraws while it streams; a new text row fades in over 150 ms (none with Reduce Motion).
- **Selection.** iOS selects through the long-press menu's Select Text sheet (the whole answer, plain
  text) rather than per-block `textSelection`, which cannot cross blocks; Android the same.

## Tests and numbers

- `cargo test -p broski-render`: 66 tests, among them every CommonMark 0.31.2 and GFM 0.29
  extension example (651 of 676 pass; the 25 others are the deliberate differences above, each named
  in `tests/spec.rs`), the agent rules (`cases.rs`), streaming (every prefix of every sample keeps the
  earlier blocks' keys and content), fuzzing, the exports, `toolBody`, `toolArguments` and `formatLog`.
- `mobile/tests/render.rs`, `RenderTests.swift` and `RenderTest.kt` call the exports from Rust, Swift
  and Kotlin.
- `cargo run --release -p broski-render --example bench` (Apple M-series, release): a 20,000-character
  message 0.34 ms, the same while it streams 0.35 ms, a 1,000,000-character text 19.5 ms.
- iOS `ChatPerformanceTests`: rebuilding the rows of a 1,000-item run with a growing answer takes
  0.098 s for 30 batches, about 3 ms a batch.
- iOS `TableWidthTests`: a page of tables in a real window stays exactly the window's width (a table
  at fixed column widths once held the page wider and cut every paragraph at the left).
- `UITests/SettingsFormattingEndToEndTests` photographs every sample in light and dark, the default
  size and AX3, upright and sideways (the iPhone Duo simulator stays upright), the table viewer and an
  expanded code block
  (`TEST_RUNNER_BROSKI_GALLERY_QUICK=1` for light, default, upright only). On Android,
  `androidTest/.../feature/format/FormattingShots` does the same at font scale 1 and 2 into
  `/sdcard/broski-shots/formatting`.
