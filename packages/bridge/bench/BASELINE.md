# Bridge performance baseline

Measured on the author's real machine against real agent data, so later optimisations are
compared against numbers instead of guesses.

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

## Top 5 worst numbers

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

## Re-running

```bash
cd packages/bridge
bun bench/run.ts --selftest                 # prove the RSS hard-kill works (200 MB cap)
bun bench/run.ts                            # full suite, default caps 3 GB / 120 s
bun bench/run.ts --filter=codex-enrich-stats,pi-list-projects
bun bench/run.ts --cap-rss-mb=1024 --cap-time-ms=90000
```

Caps can be lowered freely; the runner clamps anything above 4096 MB.
