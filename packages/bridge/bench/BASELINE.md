# Bridge performance baseline

Measured on the author's real machine against real agent data, so later optimisations are
compared against numbers instead of guesses.

The `pi-*` rows below measured the old Pi connector. That connector, its scenarios and
`src/index-cache/` were deleted on 2026-10-30, when Pi moved behind the backend contract
(`src/backends/pi/`); the rows stay as a record and cannot be re-run.

| | |
| --- | --- |
| Run | `bun bench/run.ts` (from `packages/bridge`) |
| Raw result | `bench/results/2026-10-10T01-40-10-363Z-bun1.3.5.json` |
| Bun | 1.3.5 |
| macOS | 27.0.1 (build 26A434) |
| CPU | Apple M4 Pro |
| RAM | 48 GiB |
| Caps | RSS 3072 MB, wall 120000 ms, RSS sample interval 100 ms |

## Method

* Every scenario runs in **its own child process** (`Bun.spawn` of `bench/scenarios/<name>.ts`).
  The runner samples the child's RSS every 100 ms with `ps -o rss= -p <pid>` (macOS reports KiB)
  and hard-kills it (`SIGKILL`, plus every descendant) when RSS passes the cap or the time cap
  expires. A kill is a result, not an error: `killed: "rss" | "time"` with the peak observed.
* `wall ms` in the table is the **child's whole lifetime** (bun boot + module load + measured work).
  Metrics named `wallMs` / `firstMs` inside a scenario are the measured call only — for scenarios
  that finish in ~100 ms the difference between the two is bun's own startup.
* `cpu ms` is `user + system` from the child's own `process.cpuUsage()` at exit. A value above the
  wall time means the scenario used more than one core.
* `peak RSS` is `max(sampled RSS, RSS reported at exit)`, so sub-100 ms scenarios still report a real
  number rather than zero.
* The kill path is proven by `bun bench/run.ts --selftest`, which must report `killed=rss` against a
  200 MB cap. Both full runs reported `codex-enrich-stats` killed the same way.
* Scenarios that could touch `~/.broski` run with `HOME` pointed at a fresh temp dir passed in the
  child's environment. `os.homedir()` reads `$HOME` at process start; assigning `process.env.HOME`
  after startup does **not** move it, so the runner supplies it at spawn time. The run reports
  `homeHonorsEnv: true`, `configPathUnderHome: true` and `broskiDirCreated: false`, and `~/.broski`'s
  mtimes were identical before and after. The server starts with `BROSKI_TLS=0`, `port: 0`, an
  explicit auth token and a real WebSocket client, so no TLS material, token file or config is written.
* All agent data (`~/.pi`, `~/.codex`, `~/.claude`) is **read-only**. `bench/results/` is gitignored;
  this file is not.

## Data sets on this machine

| data set | files | bytes | largest file |
| --- | --- | --- | --- |
| `~/.pi/agent/sessions` | 3152 (118 project dirs) | 6.80 GiB | 413.0 MiB |
| `~/.codex/sessions` | 1082 | 4.76 GiB | 202.6 MiB |
| `~/.codex/archived_sessions` | 1 | 573.2 KiB | 573.2 KiB |
| `~/.claude/projects` | 12 | 18.4 MiB | 3.6 MiB (a `subagents/` file) |
| `~/.codex/state_5.sqlite` | 1 | 2.6 MiB | 1035 `threads` rows, 270 with a non-empty title |

OpenCode is not installed here, so `oc_*` paths are not benchmarked.

## Results

| scenario | status | wall ms | peak RSS | cpu ms | metrics |
| --- | --- | --- | --- | --- | --- |
| `startup-version` | ok | 536 | 38.0 MiB | 35 | `bun src/index.ts version` → exit 0; spawn→exit 268 ms / 179.3 MiB; `/usr/bin/time -l`: real 220 ms, user 370 ms, sys 150 ms, maxRSS 199.1 MiB |
| `module-load` | ok | 326 | 187.0 MiB | 620 | `import ../src/server.ts` 198 ms, RSS 28.9 → 196.1 MiB (+159.5 MiB), no server started |
| `pi-list-sessions-cold` | ok | 42606 | 1615.5 MiB | 47390 | 42400 ms for 3152 sessions, 725 with diff stats, 929 with subagent tools; cache 118 dirs / 32.3 MiB |
| `pi-list-sessions-warm` | ok | 40869 | 1828.8 MiB | 45684 | 1st 40528 ms → 2nd 27 ms (**1501×**), 3152 sessions both times, cache unchanged |
| `pi-list-projects` | ok | 12804 | 1506.8 MiB | 15373 | 12512 ms for 113 projects |
| `pi-read-largest-transcript` | ok | 633 | 1811.0 MiB | 677 | scan 38 ms, read 236 ms; 433087197 B file → 433058486 chars, 865 messages → 200 returned |
| `codex-list-projects` | ok | 4160 | 1803.3 MiB | 2424 | 4061 ms via filesystem for 28 projects; sqlite fallback not needed (0 ms) |
| `codex-list-threads` | ok | 115 | 33.7 MiB | 19 | sqlite: default limit 20 ms / 200 threads; `limit: 100000` 5 ms / 270 threads |
| `codex-enrich-stats` | **KILLED (rss)** | 2271 | **3077.4 MiB** | — | 200 newest threads → 3 GiB cap hit after 2.27 s, before producing a result |
| `codex-read-largest-transcript` | ok | 3015 | 1298.5 MiB | 3154 | read 2942 ms; 212436115 B rollout → 1 message carrying 23385 tool calls, 1867 text chars |
| `cc-list-sessions` | ok | 116 | 109.2 MiB | 88 | 15 ms for 12 sessions; 0 with diff stats, 1 with subagents |
| `cc-list-projects` | ok | 322 | 134.7 MiB | 344 | 229 ms for 38 projects (recursive `$HOME` scan, depth 5) |
| `cc-read-largest-transcript` | ok | 115 | 71.7 MiB | 57 | read 5 ms; 2805668 B session → 91 messages |
| `server-idle` | ok | 60862 | 245.8 MiB | 1389 | 60 s idle: CPU 1.18 %, RSS +1.5 MiB, 4 messages, **0 child processes**, 1 client |
| `stream-throughput` | ok | 531 | 336.0 MiB | 876 | 1 client: p50 16 ms / p99 18 ms, 6.20 MB, 476k ev/s · 4 clients: p50 57 ms / p99 79 ms, 24.8 MB, 513k ev/s, 20000/20000 delivered to each |

## Run 2 — backpressure, per-session delivery, coalescing, permessage-deflate (2026-10-10)

Same machine, **Bun 1.4.2**. "before" is a pristine `git archive HEAD packages/bridge` copy in
`/tmp/broski-base` with the current `bench/` copied over it, so both sides ran byte-identical
scenarios, each in its own child process, with a temp `HOME`, TLS off and port 0.

| scenario | before (HEAD) | after |
| --- | --- | --- |
| `stream-throughput`, 1 client | 20 002 frames, **6 200 754 B** payload, p50 15 / p99 18 ms, wall 46 ms, cpu 55 ms | 73 events in 4 frames, **2 414 484 B**, p50 7–8 / p99 10–13 ms, wall 30–32 ms, cpu 28 ms |
| `stream-throughput`, 4 clients | 20 002 frames each, **6 200 757 B** each, p50 49 / p99 73 ms, wall 139 ms, cpu 123 ms | 73 events in 4 frames, **2 414 487 B** each, p50 13–16 / p99 16–23 ms, wall 29–31 ms, cpu 29 ms |
| `stream-stalled-client` | never shed (`connectionsAfterShed` 2), RSS 122 → 194 MiB (**+72**) | shed at **56–59 ms** (4 MiB socket limit), `connectionsAfterShed` 1, healthy client received all 24 M chars, RSS 121 → 187 MiB (**+65**) |

`stream-throughput` sends 20 000 deltas of 120 chars in one burst, so its byte numbers are the
payload the client can measure (a batch envelope is counted once). The burst merges 273 deltas per
event (the 32 KiB cap in `src/transport/runtime-event-coalescer.ts`), which is the best case for
coalescing; a paced stream merges far less and lands much closer to yesterday's numbers.

| `ws-deflate` (counting TCP proxy, real source text as the payload) | before | after |
| --- | --- | --- |
| 20 000-delta burst, 2.4 MB of text | 6 504 109 B (deflate not offered) | 2 715 773 B plain → **604 346 B** deflated (4.5×) |
| session list, 300 Claude Code rows | 215 102 B (`capabilities` repeated per row) | 103 492 B plain → **6 316 B** deflated (16.4×) |
| single delta per frame (200 frames) | 65 939 B | 65 372 B plain → **41 694 B** deflated (1.57×) |
| CPU, burst / list / single delta | 50 / 8 / 39 ms | 34 / 3 / 105 ms plain, 55 / 17 / 83 ms deflated |

The 4.5× on the burst is *text-dependent*: the payload is real source (`src/server.ts`,
`src/types.ts`, `bench/run.ts`, …), not `"x".repeat(120)` — the repeated-character version measures
221× and means nothing. The session-list number is high because a session list repeats its shape
per row, which is exactly the traffic that costs the most on a metered relay.

`permessage-deflate` is therefore **on by default** (`BROSKI_WS_DEFLATE=0` disables it), and every
frame is sent with `compress: true` — Bun only honours that flag when the client negotiated the
extension. Verified against a real `dart:io` WebSocket client (what the app uses, through
`web_socket_channel`): 300 paced deltas of real text arrived as **32 290 chars in 302 events with
zero binary frames and no error**, identical with the extension on and off, so the Dart side
decompresses correctly. A Bun client reports
`permessage-deflate; server_no_context_takeover; client_no_context_takeover`.

Two consequences of the fixes that the numbers alone do not show:

* **A stalled phone is shed once, not written to forever.** `backpressureLimit` 4 MiB with
  `closeOnBackpressureLimit` closes it, the send queue holds coalescable deltas instead of growing
  the socket buffer, and 4 MiB of unsent frames sheds it too. Before, `send()`'s `-1`/`0` was
  ignored at every site, so the bridge buffered up to Bun's 16 MiB default per socket and dropped
  frames silently.
* **A stream costs one copy per viewer, not one per connected socket.** Before, one Claude Code
  delta was handed to every socket (`emitCcStream`), so 8 phones cost 8× the bytes. Now only the
  owner and the sockets viewing that session get the deltas; every other socket gets just the
  busy/idle/retry/error/tool-started activity it needs for the sessions list, with `seq` removed so
  the app's lost-event detector (`seq > last + 1` → it switches its view) cannot fire for a session
  the phone is not looking at.

## Top 5 worst numbers
*** End Patch

1. **`codex-enrich-stats` cannot finish on this data set — killed at 3.01–3.08 GiB in both runs.**
   `enrichThreadsWithStats` (`src/connectors/codex-fs.ts:602`) enriches every thread through
   `await Promise.all(needStats.map(...))` (`:635`) — unbounded concurrency — and each thread is read
   whole into one JS string by `Bun.file(filePath).text()` (`:371`). 200 threads include several
   100 MB+ rollouts pulled in at once. Same failure mode as the 38 GB Pi scan in `AGENTS.md`; the fix
   has the same shape as `enrichPiSessionsWithStats` (`src/connectors/pi/pi-session-enrich.ts:26`),
   which caps concurrency at 4.
2. **`pi-list-sessions-cold` = 42.4 s / 1.62 GiB** to list 3152 sessions. `listSessions`
   (`src/connectors/pi/pi-session-queries.ts:24`) lists every project dir and then enriches; the cost
   is set by 118 dirs and 6.8 GiB of JSONL, and it is paid on the first `pi_list_sessions` after every
   bridge restart.
3. **`pi-list-sessions-warm` first call 40.5 s, second call 27 ms (1501×).** The only thing that makes
   this fast is the process-local directory cache in `pi-session-list-cache.ts:54`; it starts empty,
   so what the user sees after a restart is the cold number.
4. **`pi-list-projects` = 12.5 s / 1.51 GiB for 113 rows.** It is `listAllSessionInfos`
   (`pi-session-list-cache.ts:179`) again — the same 6.8 GiB scan, run a second time for a list the
   session listing already had the data for.
5. **`codex-list-projects` = 4.1 s / 1.80 GiB for 28 rows.** `listProjectsFromFs`
   (`src/connectors/codex-fs.ts:227`) walks all 1082 rollout files and calls `readSessionMeta` on each,
   which does `Bun.file(...).text()` (`:71`) — a full 4.76 GiB read to extract one JSON line and a
   preview per file. The sqlite index already has the same `cwd` values behind an indexed query
   (`listProjectsFromDb`), which is only consulted when the filesystem returns *zero* projects.

## Also worth knowing

* **The transcript read path is memory-heavy but fast.** `pi-read-largest-transcript` holds 1.81 GiB
  of RSS for a 433 MB file (≈4.2× the file size) to return 200 of 865 messages;
  `codex-read-largest-transcript` holds 1.30 GiB for a 202 MB rollout, and that rollout is a single
  message carrying **23 385 tool calls** — model objects, not text, dominate the cost.
* **The streaming path is in good shape.** 20 000 deltas reached every client with zero drops at both
  1 and 4 clients over two runs. `RuntimeSendQueue.broadcast` (`src/utils/runtime-send-queue.ts:61`)
  serialises once and `ws.send`s per socket; each extra client adds ~2.4 ms and ~6.2 MB of wire for
  20k frames.
* **Idle is cheap.** `server-idle` burned 0.91–1.18 % CPU and +1.5–2.0 MiB over 60 s with zero child
  processes, so the 20 s heartbeat (`src/server.ts:1855`) and the 30 s tick are not a cost problem.
* **Bridge startup is not a bottleneck.** 268 ms for `version`, and 198 ms / +159 MiB to import
  `src/server.ts` (which pulls in all four SDKs).

## Variance

Two full runs of the suite, same caps, same data set:

| scenario | run 1 | run 2 |
| --- | --- | --- |
| `pi-list-sessions-cold` | 38.6 s / 1795 MiB | 42.6 s / 1616 MiB |
| `pi-list-sessions-warm` | 37.3 s / 1737 MiB | 40.9 s / 1829 MiB |
| `pi-list-projects` | 13.8 s / 1522 MiB | 12.8 s / 1507 MiB |
| `codex-list-projects` | 2.60 s / 1878 MiB | 4.16 s / 1803 MiB |
| `codex-enrich-stats` | killed, 3.01 GiB / 1.66 s | killed, 3.08 GiB / 2.27 s |
| `cc-list-projects` | 1.10 s / 127 MiB | 0.32 s / 135 MiB |

Treat RSS as ±40 % and wall time as ±10–20 %; `cc-list-projects` varied 3.4× because it scans
directories that other work is writing at the same time. Only compare a scenario against the same
scenario, with the same caps and the same data set.

## Pi session index — after the listing rework

Measured on the same machine and data set as above (3 153 files, 6.81 GiB), with the scenarios as they
are now. `pi-list-sessions-cold-sdk` is the old code path (an injected `lister` forces
`SessionManager.listAll`), kept so the comparison is against a number rather than a memory.

| scenario | before | after |
| --- | --- | --- |
| `pi-list-sessions-cold` (empty index) | 18.6 s / 1.55 GiB (`*-cold-sdk`: 11.6 s list + 7.0 s enrich) | **9.4 s** / 1.24 GiB, index 18.5 MB |
| `pi-list-sessions-warm` (second call) | 27 ms | **14 ms** (first call 9.4 s) |
| `pi-list-sessions-restart` | n/a — every start paid the cold cost | **40 ms** in-process, **323 ms** process wall, peak 245 MB |
| `pi-list-projects` | 12.5 s / 1.51 GiB | **9.8 s** with an empty index; 12 ms with the index warm |
| `pi-index-parity` | n/a | 3 153 files, **0** mismatches per file and **0** through the index |

Raw results: `bench/results/2026-10-10T03-27-34-371Z-bun1.4.2.json`.

### The mechanism

* `src/index-cache/` — a versioned JSON-lines index at `~/.broski/cache/pi-session-index.jsonl`
  (injectable root, `BROSKI_CACHE_DIR`). One record per session file holds the fields the bridge sends
  plus the diff stats, keyed by `(path, mtimeMs, size, ino)`. **JSONL over `bun:sqlite`:** for 3 220
  records a load is 2.08 ms median against 2.70 ms, and a whole-file rewrite 0.54 ms against 6.74 ms,
  and JSONL has no `-wal`/`-shm` sidecars to chmod. Writes go through a 0600 temp file and a rename
  inside a 0700 directory; a corrupt line is dropped, a corrupt or version-mismatched file is
  discarded, and a file larger than the 128 MB budget is ignored rather than loaded.
* `pi-session-info-fast.ts` — the per-file `SessionInfo` is computed from the first 4 KiB of each line
  (`jsonl-line-spans` plus a small JSON scanner) instead of `JSON.parse` on every line: 419 977 lines,
  9.1 % of them needing a full read. The 3 153 headers and ~35 k long user/assistant messages are parsed
  in full, because `message.timestamp` sits after the content and reading it from the tail of a line is
  unsound — Pi's `diagnostics` object carries `timestamp` keys of its own.
* **Parity.** `pi-index-parity` compares every field `mapSessionInfo` sends against the SDK's own
  `SessionManager.listAll` for all 3 153 files, and reports **0 mismatches** — per file, and again
  through a freshly built index (`indexMismatches: 0`), which is the path the phone actually reads. 11
  files contain a raw `\u2028`/`\u2029`, which Node's readline (and so the SDK) breaks lines on and
  `readJsonlLines` does not; the stats scan flags those files and the listing reads them with the SDK's
  own reader (`pi-session-info-readline.ts`), which also matches on all 3 153 files. Before the
  `completesLine` fix — comparing a line's byte length against the head's character length — every
  non-ASCII line was misjudged and the fallback fired on 65 k extra lines.
* **Warm.** `index.ts` starts `warmPiSessionIndex()` once the listener is up: bounded concurrency, an
  event-loop yield every 16 files, and a single-flight refresh shared with any request that arrives
  while it runs.

### Still open

* `codex-list-projects` (4.1 s / 1.8 GiB) is still `listProjectsFromFs` reading every rollout whole for
  its first line. The same index would fix it, but the files it lives in belong to the transcript work
  this round; a head-only read (`readJsonlHead`) is the smaller change.
* Claude Code needs nothing: 15 ms for 12 sessions and 229 ms for 38 projects.
* The stats scan is now the cold path's own bottleneck: 8.4 s of the 9.4 s, and it decodes every line.
  Prefiltering on the line head does not work — a tool call can follow a long thinking block.
* `pi-index-parity` peaks at 2.8 GiB because it holds the SDK's `allMessagesText` for a directory while
  comparing; lowering it would mean comparing per file instead of per directory.

## Re-running

```bash
cd packages/bridge
bun bench/run.ts --selftest                 # prove the RSS hard-kill works (200 MB cap)
bun bench/run.ts                            # full suite, default caps 3 GB / 120 s
bun bench/run.ts --filter=codex-enrich-stats,cc-list-projects
bun bench/run.ts --cap-rss-mb=1024 --cap-time-ms=90000
```

Caps can be lowered freely; the runner clamps anything above 4096 MB.
