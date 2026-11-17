# Formatting — Broski's own formatter

Everything an agent writes (its answers, its thinking, a plan, a subagent's report, an activity's
message) reaches the person's eyes through one formatter, the same on iOS and Android. It is ours:
there is no markdown library in the core or either app. The plan it is being built to is
[`docs/rebuild/formatting-plan.md`](../rebuild/formatting-plan.md).

```
agent text ──► broski-render `format` (Rust: parse, repair while streaming, key)
           ──► BroskiCore `formatMarkdown(text, streaming) → [FormatBlock]`
           ──► iOS `Sources/Formatting/` · Android `design/format/` (measure and draw only)
```

## The rule

**Every string an agent wrote is drawn through the formatter's views, never a bare `Text`.** On iOS
that is `FormattedText` (a whole text) or `FormatBlockView` (one block of a lazy list); on Android the
composables of the same names. A new screen that shows agent text uses them; a fix to how text looks
is made in the formatter, so it lands on every screen of both apps at once.

What is agent text: the transcript's text blocks, thinking, a subagent's text (Android's work rows),
a plan to approve, an activity's markdown body, a markdown text page. Tool output, tool arguments,
notices and the person's own messages are drawn plainly today; the plan moves each to the formatter.

## The core: `packages/link/render/src/format/`

```
FormatBlock   { key, content: FormatContent }
FormatContent = Paragraph { spans: [FormatSpan] } | Code { language?, text, closed }
FormatSpan    { text, code }
```

- **Keys.** A block's `key` is its kind and the byte offset its source starts at (`p-0`, `code-34`).
  Text appended later cannot move an earlier block's start, so while a message streams every block but
  the last keeps its key and content, and only the last redraws. Both apps use the key as the view's
  identity (the transcript's rows are `"<blockId>/<key>"`).
- **Streaming.** `streaming` says more text is coming. Markup still open at the very end is closed
  rather than shown as written: today, an inline code span whose closing backticks have not arrived.
  An unclosed fence is a code block to the end of the text with `closed: false`; the apps colour it
  only once it closes.
- **What it parses today**: paragraphs (line breaks kept as written), fenced code (three or more
  backticks or tildes, closed only by an equal or longer run of the same character, indented up to
  three spaces), and inline code (a run of backticks closed by a run of the same length). Everything
  else in the plan (headings, lists, quotes and callouts, tables, emphasis, links and paths, math,
  footnotes) is still to be built.
- **Bounds.** The first `MAX_FORMAT_BYTES` (1 MiB, the contract's `MAX_TEXT_CHARS`) are parsed; the
  rest is one plain paragraph keyed `rest-<offset>`.
- **Samples.** `formatSamples()` returns the corpus in `render/tests/fixtures/format/`: agent-shaped
  text with every case the formatter must draw well. Each app lists it under Settings › Formatting,
  where a sample shows as an answer, as a quiet row or as its source, and Replay streams it in 12
  characters a batch at 30 batches a second, as an answer arrives.

## The apps

| | iOS (`apps/ios/Broski/Sources/Formatting/`) | Android (`design/format/`) |
|---|---|---|
| A whole text | `FormattedText(text:role:streaming:limit:)` | `FormattedText(text, role, streaming, limit)` |
| One block | `FormatBlockView(block:role:)`, `Equatable` | `FormatBlockView(block, role)` |
| Parse cache | `FormatCache.shared` (main actor) | `FormatCache` (synchronized LRU) |
| Gallery | `FormattingGalleryScreen` | `FormattingGallery` sheet (`feature/settings/`) |

`FormatRole` sets size and emphasis: `page` for the answer the person reads, `quiet` for what sits
under a row (thinking, a subagent's or an activity's text). The transcript makes one row per block, so
a long answer stays lazy and only its last block redraws while it streams.

## Tests

`cargo test -p broski-render format`: blocks and keys of an answer, fence rules (longer fences, tildes,
backticks in an info string, four-space indents), an unclosed fence, inline code runs and stray
backticks, the open code span repaired while streaming, a message streamed one character at a time
whose earlier blocks never change, the byte bound, and every sample. `mobile/tests/render.rs`,
`RenderTests.swift` and `RenderTest.kt` call the exports from Rust, Swift and Kotlin.
