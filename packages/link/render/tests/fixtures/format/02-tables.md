Here is how the three options compare:

| Option | Bundle size | Cold start | Streaming | Verdict |
|---|---:|---:|:---:|---|
| pulldown-cmark | 180 KB | 0.2 ms | ❌ | Fast, but no repair of half-written markup |
| Our own parser | ~90 KB | 0.1 ms | ✅ | Chosen: one pass, keys stable while text grows |
| A WebView with marked | 4.1 MB | 380 ms | ✅ | Too slow to open, and selection feels foreign |

A narrow one:

| Key | Value |
|---|---|
| Machine | `studio-mbp` |
| Route | LAN (192.168.1.24) |
| Latency | 4 ms |

A very wide one with long cells:

| File | What changed | Why | Risk | Tests |
|---|---|---|---|---|
| `packages/bridge/src/backends/claude-code/mapping/tool-results.ts` | The result of a subagent now keeps its markdown instead of flattening it | The phone could not tell a report from a log | Low: the text is the same, only its kind is new | `tool-results.test.ts`, two new cases |
| `apps/ios/Broski/Sources/Features/Chat/Work/ToolDetailView.swift` | Draws the result through the formatter | Raw `**stars**` showed in every subagent report | Medium: a long report is now laid out, so it is taller | Gallery screenshots at 375, 402 and 440 pt |
| `apps/android/app/src/main/kotlin/com/muzammil/broski/feature/chat/work/WorkDetail.kt` | Same as iOS | Same | Medium | Roborazzi-free: the gallery on a Pixel 9 |

A table with missing cells and escaped pipes:

| Command | Meaning |
|---|---|
| `a \| b` | pipe a into b |
| `cmd &` |
| `x` | three | cells |
