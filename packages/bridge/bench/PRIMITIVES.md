# Session-file primitives — measurements

Numbers behind `src/utils/jsonl-lines.ts`, `src/utils/jsonl-tail.ts` and `src/utils/file-fingerprint-cache.ts`,
so the Codex / Claude Code / transcript fixes compare against data instead of intuition. Companion to
`BASELINE.md`, which profiles the current end-to-end scenarios.

| | |
| --- | --- |
| Measured | Apple M4 Pro, 48 GiB, macOS 27.0.1 (26A434), Bun 1.4.2 |
| Files | `~/.pi/.../2026-07-25T20-18-38-350Z_019f9aee….jsonl` — 433 087 197 B (413 MiB), 1 912 lines, longest line 68 536 380 B |
| | `~/.codex/sessions/2026/05/31/rollout-2026-05-31T03-23-35-019e7ae0….jsonl` — 212 436 115 B (203 MiB), 109 927 lines, longest line 75 414 B |
| Method | Each candidate runs in its own `bun` process; 5 reps; wall time from `performance.now()`, peak RSS from `process.resourceUsage().maxRSS`. Files read only. |
| Cap | Every run bounded by a shell RSS watchdog (±2.5 GiB); no run exceeded 1.3 GiB. |

The Pi file is pathological on purpose: its 1912 lines average 226 KiB, and one line is 68 MiB. Any reader
that re-copies a growing line prefix per chunk is quadratic here, so the shipped splitter accumulates
decoded slices and joins once.

## Line readers — whole file

Candidates: (a) `node:readline` over `fs.createReadStream`; (b) `Bun.file(path).stream()` piped through
`TextDecoderStream`; (c) `FileHandle.read` into one reused 1 MiB `Buffer` with a streaming `TextDecoder`.
"Whole file" is `Bun.file(path).text().split("\n")` — the pattern being replaced. Median of 5.

| candidate | Pi ms | Pi MB/s | Pi maxRSS | Codex ms | Codex MB/s | Codex maxRSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| (a) readline, 64 KiB chunks | 336 | 1229 | 582 MB | 269 | 754 | 75 MB |
| (a) readline, 1 MiB chunks | 316 | 1309 | 457 MB | 167 | 1212 | 105 MB |
| (b) Bun stream + TextDecoderStream | 69 | 5953 | 248 MB | 57 | 3584 | 58 MB |
| (c) fs.read, reused 1 MiB buffer | 73 | 5661 | 273 MB | 51 | 3934 | 71 MB |
| whole-file read + split | 109 | 3789 | 1257 MB | 63 | 3236 | 626 MB |

**(b) and (c) are statistically tied** — the ranking flips between the two files and between runs, both run
at ~5.5–6.0 GiB/s on Pi and ~3.6–3.9 GiB/s on Codex, ~4–5× the readline throughput. They differ in memory:
over the whole file neither grows with file size, but measured through the shipped **generator** API the
Bun-stream variant peaks at **651 MB** on the Pi file against **403 MB** for the reused buffer, because the
68 MiB line is held across the generator suspension and the stream variant additionally allocates a fresh
`Buffer` per chunk.

Chosen: **(c)**. Reused buffer, lowest and flattest peak RSS, no per-chunk allocation, and `chunkBytes` makes
the read boundary deterministic enough to test multi-byte splits directly.

## Shipped readers

`readJsonlLines` consumed line-by-line (what a transcript builder pays), `readJsonlHead` stopping on the
second line, and `readJsonlTail(200)`. Median of 5.

| call | Pi ms | Pi maxRSS | Codex ms | Codex maxRSS | notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `readJsonlLines` (all lines) | 97 | 403 MB | 59 | 88 MB | yields every line to an async consumer |
| `readJsonlHead({ until: index >= 1 })` | 1 | 21 MB | 1 | 22 MB | stops after 2 lines |
| `readJsonlTail({ maxLines: 200 })` | 74 | 391 MB | 2 | 28 MB | 0.1 MB read on Codex, 91 MB on Pi |
| `readJsonlTail({ maxLines: 200, maxBytes: 1 MiB })` | 3 | 29 MB | 2 | 28 MB | 7 Pi lines fit in the cap |

The tail wins are the point: the Codex rollout needs **0.1 MB / 2 ms** for its last 200 messages instead of
**203 MB / 63 ms** for the whole file, at 28 MB peak against 626 MB. The Pi file needs 91 MB because its
last 200 lines are simply 91 MB of text, still 4.5× fewer bytes than whole-file and with a lower ceiling.

## Decisions

* `readJsonlLines` / `readJsonlHead` / `readJsonlTail` share one splitter (`consumeChunk`); the tail reader
  seeks backwards from EOF and decodes the concatenated suffix once, so a chunk boundary inside a
  multi-byte character or a line reassembles correctly.
* `chunkBytes` (default 1 MiB) is exposed so tests can place the read boundary on a multi-byte character.
* `runPool` is fail-fast by contract: after the first rejection no new items start, in-flight tasks are
  awaited, and the first error is rethrown.
* `FileFingerprintCache` is a class with an injectable `fingerprint` and byte estimator; `shedOnPressure`
  clears it on `process.on("memoryPressure", "critical")`.
