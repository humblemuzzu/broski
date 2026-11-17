# Findings: where tool output is drawn

## Summary

Tool output is drawn as **plain monospace text** in both apps. Nothing passes it through the formatter, so a
subagent's markdown report shows its markup as written.

## Evidence

| App | File | Line | What it does |
|---|---|---:|---|
| iOS | `Features/Chat/Work/ToolDetailView.swift` | 63 | `Text(clip.text)` in a monospaced footnote font |
| iOS | `Features/Chat/Work/WorkRowView.swift` | 81 | `Text(thinking.text)` |
| Android | `feature/chat/work/WorkDetail.kt` | 54 | `Prose(entry.text)` |
| Android | `feature/chat/work/WorkDetail.kt` | 71 | `Mono(clip.text, …)` |

## Recommendation

- Route every agent-authored string through one view per app.
- Let the adapters say what a result is (`markdown`, `file_text`), so the phone does not guess.

## Gaps

- I did not check the Pi adapter's `read` output on a binary file.
