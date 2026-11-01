# Perf budgets (synthetic subset)

`bench/budgets.ts` holds the bounds; `bench/check-budget.ts` applies them to one or more
`bench/run.ts` JSON runs and exits 1 on any failure. CI runs the subset **three times** and feeds all
three runs to the checker, because a single wall-clock sample on a GitHub runner swings 2-5x:

```bash
BENCH_SERVER_IDLE_MS=8000 BENCH_SOAK_DURATION_MS=10000
for i in 1 2 3; do
  bun bench/run.ts --out=/tmp/broski-bench-$i.json \
    --filter=startup-version,module-load,cc-synthetic-list-projects,cc-synthetic-list-sessions,stream-throughput,stream-stalled-client,server-idle,soak-sessions,pty-main-thread-stall
done
bun bench/check-budget.ts /tmp/broski-bench-1.json /tmp/broski-bench-2.json /tmp/broski-bench-3.json
```

Scenarios that read `~/.pi` or `~/.claude` carry `requiresDatasets` in
`bench/lib/scenarios.ts` and are skipped automatically when the dataset is missing (a bare CI
runner has none).

## Two kinds of gate

**Capacity and behaviour** checks (bytes, frame/event counts, coalescing ratio, flags, `equals`) are
judged on the **worst of the three runs** and sit ~2x the worst measured value. A leak, an unbounded
queue, a dropped message or a lost merge fails in whichever run shows it. Nothing here is timing
derived, so repeating the run costs nothing in flakiness.

**Time** checks (wall ms, CPU ms/%, latency, rate) carry `gate: "median"`: the bound applies to the
**median** of the three runs (lower-middle sample for an even count — never an interpolated value),
and sits ~10x the measured median. They exist to catch an order-of-magnitude regression (a stream
that takes seconds instead of tens of ms), not a 3x one. Every time gate is marked, so adding a
scenario to the CI filter does not create a single-sample gate.

Why the median and not a looser single-sample bound: on 2026-10 CI run 38030900020 failed on
`stream-throughput.c1_p99Ms = 353 (max 250)` and passed on the re-run — the same code, the same gate.
A median over three runs absorbs exactly that, while the deterministic gates below keep the
regression coverage. Tightening or loosening a single-sample bound cannot do either.

## What catches which regression

Measured under the same `--cpus=2` container with a `yes > /dev/null` stressor, with the regression
applied temporarily to `src/` and reverted afterwards:

| reintroduced regression | gate that fires | measured → bound | latency gates |
| --- | --- | --- | --- |
| native PTY reader waits in `poll(fd, 120)` on the JS thread (the pre-fix reader) | `pty-main-thread-stall.idleStallP99Ms` 366.75 → 10, `pty-main-thread-stall.echoP50Ms` 122.36 → 30 | 2 checks fail | 3 idle PTYs, JS-thread yield p99: 366 ms → 0.02 ms |
| coalescing disabled (`RuntimeEventCoalescer.push` emits every delta) | `c*_charsMin` 0, `c*_charsPerEventMin` 0, `c*_eventsPerSec` 0, `stream-stalled-client.healthyComplete` false and `connectionsAfterShed` 0 — 20 000 unflushed parts trip the send queue's overflow guard (4 096 frames / 4 MiB) and both sockets are shed | 8 checks fail | p99 never measured (nothing delivered) |
| per-delta immediate sends (send-queue bypassed **and** coalescing off) | `c*_eventsMax` 20 000 → 400, `c*_framesMax` 20 002 → 48, `c*_charsPerEventMin` 120 → 4000, `c*_wireBytesMax` 6.20 MB → 3.2 MB | 8 checks fail | p50 161/383 ms, p99 209/598 ms — **pass**, so latency is not the guard here |
| send-queue batching off only (coalescing intact) | `c*_framesMax` 75 → 48; every other stream gate passed | 2 checks fail | p99 10/22 ms — again no latency signal |

The lesson from the third row: immediate delivery is *faster* per message, so a latency gate can
never see the missing batching. `framesMax` is what sees it, and it is deterministic (2-4 frames
idle, 4 contended, 75 with batching off).

## Measured values and the bounds

macOS column: Apple M4 Pro, 48 GiB RAM, macOS 27.0.1, bun 1.4.2, shortened CI knobs. Linux idle
column: `oven/bun:1.4.2`, `--cpus=2 --memory=6g`, 4 runs of the CI subset. Linux contended column:
same container plus one `yes > /dev/null`, 3 runs; `[a, b, c]` is the three samples.

| check | macOS | Linux idle | Linux contended | bound |
| --- | --- | --- | --- | --- |
| `startup-version.directExitCode` | 0 | 0 | 0 | must stay 0 |
| `startup-version.directWallMs` | 268 ms | 26 ms | 26 ms | ≤ 2000 ms *(median)* |
| `module-load.loadedSdkPackages` | `(none)` | `(none)` | `(none)` | must stay `(none)` |
| `module-load.peakRssBytes` | 42.1 MiB | 40.8 MiB | 40.6 MiB | ≤ 96 MiB |
| `module-load.wallMs` | 130 ms | 106 ms | 109 ms | ≤ 2000 ms *(median)* |
| `cc-synthetic-list-projects.peakRssBytes` | 35.7 MiB | 41.6 MiB | 41.3 MiB | ≤ 96 MiB |
| `cc-synthetic-list-projects.coldMs` | 107 ms | 287 ms | [152, 147, 473] | ≤ 2000 ms *(median)* |
| `cc-synthetic-list-sessions.peakRssBytes` | 847.9 MiB | 800.0 MiB | 756.3 MiB | ≤ 1600 MiB |
| `cc-synthetic-list-sessions.coldMs` | 450 ms | 745 ms | [1061, 1526, 5176] | ≤ 8000 ms *(median)* |
| `cc-synthetic-list-sessions.warmMs` | 43 ms | 37 ms | [206, 71, 634] | ≤ 500 ms *(median)* |
| `cc-synthetic-list-sessions.coldCount` | 4020 | 4020 | 4020 | ≥ 4000 |
| `cc-synthetic-list-sessions.transcriptMatch` | true | true | true | must stay true |
| `stream-throughput.c*_charsMin` | 2 400 000 | 2 400 000 | 2 400 000 | ≥ 2 400 000 (all 20 000×120 chars) |
| `stream-throughput.c*_eventsMax` | 73 | 73 | 73 | ≤ 400 |
| `stream-throughput.c*_framesMax` | 4 | 4 | 4 | ≤ 48 |
| `stream-throughput.c*_charsPerEventMin` | 32 876 | 32 876 | 32 876 | ≥ 4000 |
| `stream-throughput.c*_wireBytesMax` | 2 414 430 | 2 414 412 | 2 414 412 | ≤ 3 200 000 |
| `stream-throughput.peakRssBytes` | 203.4 MiB | 174.0 MiB | 176.9 MiB | ≤ 448 MiB |
| `stream-throughput.c*_p50Ms` | 26 / 57 ms | 22 / 29 ms | 11 / 21 ms | ≤ 500 ms *(median)* |
| `stream-throughput.c*_p99Ms` | 58 / 79 ms | 44 / 29 ms | 14 / 28 ms | ≤ 1000 ms *(median)* |
| `stream-throughput.c1_eventsPerSec` / `c4_` | 768 / 5309 | 1973 / 4710 | 1973 / 4710 | ≥ 150 / 400 *(median)* |
| `stream-stalled-client.stalledShedAtMs` | 59 ms | 77 ms | [74, 78, 76] | ≤ 2000 ms *(median)* |
| `stream-stalled-client.rssGrowthMb` | +131 MiB | +126 MiB | +125 MiB | ≤ 320 MiB |
| `stream-stalled-client.peakRssBytes` | 192.1 MiB | 177.0 MiB | 176.3 MiB | ≤ 384 MiB |
| `server-idle.peakSelfRssBytes` | 126.4 MiB | 114.7 MiB | 113.9 MiB | ≤ 256 MiB |
| `server-idle.rssDeltaBytes` | +0.5 MiB | +0.0 MiB | −5.0 MiB | ≤ 32 MiB |
| `server-idle.cpuPercent` | 0.36 % | 0.53 % | 0.20 % | ≤ 5 % *(median)* |
| `soak-sessions.peakRssBytes` | 122.9 MiB | 114.3 MiB | 114.2 MiB | ≤ 256 MiB |
| `soak-sessions.rssDeltaBytes` | +2.6 MiB | −2.6 MiB | −2.5 MiB | ≤ 32 MiB |
| `soak-sessions.cpuMs` | 329 ms | 638 ms | [282, 385, 266] | ≤ 4000 ms *(median)* |
| `soak-sessions.views` | 375 | 359 | 360 | ≥ 50 |
| `pty-main-thread-stall.idleStallP99Ms` | [0.02, 0.01, 0.03] | [0.02, 0.02, 0.01] | [0.01, 0.02, 0.01] | ≤ 10 ms *(median)* |
| `pty-main-thread-stall.idleStallMaxMs` | [0.02, 0.01, 0.03] | [0.02, 0.02, 0.01] | [0.01, 0.02, 0.01] | *(reported only)* |
| `pty-main-thread-stall.echoP50Ms` | [0.07, 0.09, 0.20] | [0.26, 0.29, 0.29] | [0.16, 0.15, 0.13] | ≤ 30 ms *(median)* |
| `pty-main-thread-stall.peakRssBytes` | 27.7–28.1 MiB | 33.4–33.7 MiB | 33.1–33.6 MiB | ≤ 256 MiB |
| `pty-main-thread-stall.idleSessionsRunning` | 3 | 3 | 3 | ≥ 3 |
| `pty-main-thread-stall.echoSamples` | 15 | 15 | 15 | ≥ 5 |
| `pty-main-thread-stall.yieldSamples` | 60 | 60 | 60 | ≥ 25 |

The contended `warmMs` sample of 634 ms is the point of the median: on an idle container the same
measurement is 37-43 ms, so a single contended sample would have failed a 500 ms bound on nothing but
CPU neighbours.

`pty-main-thread-stall` opens three idle native PTY sessions (a `sleep 60` child each) and times
`await Bun.sleep(0)` on the JS thread, then the echo round trip of a fourth live session. Before the
fix each reader waited in `poll(fd, 120)` on that thread, so one idle session resolved every await in
the process 121 ms late, three of them 363 ms late, and the same scenario read `idleStallP99Ms` 366.75
/ `echoP50Ms` 122.36 over 39 s. The reader now leaves the wait to the event loop (0.01-0.03 ms p99 on
both platforms, contended or not), so the bound on it sits between the two rather than under both: the
old reader fails it 36x over, the new one passes it with room to spare.

The three counters around it are the deterministic half of the gate: a scenario that never created a
session, or whose reader silently returned nothing, would otherwise report a perfectly quiet thread.
`idleSessionsRunning` and `echoSamples` fail that case, and the two timing bounds above it are the
only things here measured on a shared runner's clock.

The gate needs the native helper, which is not built on a bare runner: the scenario compiles
`native/pty/pty_helper.c` into `dist/` when it is missing and fails the job if `cc` cannot, rather
than passing on metrics it never took. Its Linux columns come from the same `oven/bun:1.4.2` proxy
(idle and with one `yes > /dev/null`), 3 samples per column.

The two `rssDeltaBytes` bounds are leak gates rather than 2x-of-measured: the 8 s window's own
sampling noise already reaches ±8 MiB, and the 60 s runs in `BASELINE.md` drift +1.5–2.0 MiB. A real
leak in a bounded map shows up as tens of MiB per minute, which 32 MiB still catches.

Time metrics use the shortened CI knobs; the full-length run (`BENCH_*` unset) reports
`server-idle` 60 s / `soak-sessions` 60 s with the same RSS and CPU bounds.

`startup-version.timeTool` is environmental — `/usr/bin/time` is BSD `-l` on macOS, absent from the
`oven/bun` image, and GNU `-v` on a runner that has it — so the scenario reports it and no bound
depends on it.
