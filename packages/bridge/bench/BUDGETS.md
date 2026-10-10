# Perf budgets (synthetic subset)

`bench/budgets.ts` holds the bounds; `bench/check-budget.ts` applies them to a `bench/run.ts`
JSON run and exits 1 on any failure. CI runs only scenarios that need no developer data:

```bash
BENCH_SERVER_IDLE_MS=8000 BENCH_SOAK_DURATION_MS=10000 \
  bun bench/run.ts --out=/tmp/broski-bench.json \
    --filter=startup-version,module-load,cc-synthetic-list-projects,cc-synthetic-list-sessions,stream-throughput,stream-stalled-client,server-idle,soak-sessions
bun bench/check-budget.ts /tmp/broski-bench.json
```

Scenarios that read `~/.pi`, `~/.codex` or `~/.claude` carry `requiresDatasets` in
`bench/lib/scenarios.ts` and are skipped automatically when the dataset is missing (a bare CI
runner has none).

## How the bounds were set

Capacity bounds (bytes, counts of memory) are ~2× the worst value measured across both columns, so a
reintroduced leak or unbounded scan still fails. Wall-time, CPU and latency bounds are ~4×, because a
shared runner swings those most. Correctness checks (`equals`, minimum counts, delivered characters,
events/s floors) are not scaled — they fail on behaviour, not on speed.

Linux column measured inside `oven/bun:1.4.2` on Docker Desktop, `--cpus=2 --memory=6g` (a GitHub
`ubuntu-latest` box is comparable), 4 runs of the CI subset, worst value shown. macOS column: Apple
M4 Pro, 48 GiB RAM, macOS 27.0.1, bun 1.4.2, shortened CI knobs.

## Measured values and the bounds

| check | macOS measured | Linux CI measured | bound |
| --- | --- | --- | --- |
| `startup-version.directExitCode` | 0 | 0 | must stay 0 |
| `startup-version.directWallMs` | 268 ms | 26 ms | ≤ 2000 ms |
| `module-load.loadedSdkPackages` | `(none)` | `(none)` | must stay `(none)` |
| `module-load.peakRssBytes` | 37.5 MiB | 41.3 MiB | ≤ 96 MiB |
| `module-load.wallMs` | 130 ms | 105 ms | ≤ 2000 ms |
| `cc-synthetic-list-projects.peakRssBytes` | 35.5 MiB | 41.6 MiB | ≤ 96 MiB |
| `cc-synthetic-list-projects.coldMs` | 107 ms | 287 ms | ≤ 2000 ms |
| `cc-synthetic-list-sessions.peakRssBytes` | 847.9 MiB | 763.0 MiB | ≤ 1600 MiB |
| `cc-synthetic-list-sessions.coldMs` | 450 ms | 745 ms | ≤ 8000 ms |
| `cc-synthetic-list-sessions.warmMs` | 43 ms | 37 ms | ≤ 500 ms |
| `cc-synthetic-list-sessions.coldCount` | 4020 | 4020 | ≥ 4000 |
| `cc-synthetic-list-sessions.transcriptMatch` | true | true | must stay true |
| `stream-throughput.c1_charsMin` / `c4_charsMin` | 2 400 000 | 2 400 000 | ≥ 2 400 000 (all 20 000×120 chars) |
| `stream-throughput.c1_p99Ms` / `c4_p99Ms` | 58 / 26 ms | 44 / 29 ms | ≤ 250 / 300 ms |
| `stream-throughput.c1_eventsPerSec` / `c4_eventsPerSec` | 768 / 5309 | 1973 / 4710 | ≥ 150 / 400 |
| `stream-throughput.peakRssBytes` | 199.0 MiB | 166.0 MiB | ≤ 448 MiB |
| `stream-stalled-client.stalledShedAtMs` | 59 ms | 77 ms | ≤ 1000 ms |
| `stream-stalled-client.rssGrowthMb` | +131 MiB | +126 MiB | ≤ 320 MiB |
| `stream-stalled-client.peakRssBytes` | 192.1 MiB | 177.0 MiB | ≤ 384 MiB |
| `server-idle.peakSelfRssBytes` | 126.4 MiB | 114.7 MiB | ≤ 256 MiB |
| `server-idle.rssDeltaBytes` | +0.5 MiB | +0.0 MiB | ≤ 32 MiB |
| `server-idle.cpuPercent` | 0.36 % | 0.53 % | ≤ 5 % |
| `soak-sessions.peakRssBytes` | 122.9 MiB | 114.3 MiB | ≤ 256 MiB |
| `soak-sessions.rssDeltaBytes` | +2.6 MiB | −2.6 MiB | ≤ 32 MiB |
| `soak-sessions.cpuMs` | 329 ms | 638 ms | ≤ 4000 ms |
| `soak-sessions.views` | 375 | 359 | ≥ 50 |

The two `rssDeltaBytes` bounds are leak gates rather than 2×-of-measured: the 8 s window's own
sampling noise already reaches ±8 MiB, and the 60 s runs in `BASELINE.md` drift +1.5–2.0 MiB. A real
leak in a bounded map shows up as tens of MiB per minute, which 32 MiB still catches.

Time metrics use the shortened CI knobs; the full-length run (`BENCH_*` unset) reports
`server-idle` 60 s / `soak-sessions` 60 s with the same RSS and CPU bounds.

`startup-version.timeTool` is environmental — `/usr/bin/time` is BSD `-l` on macOS, absent from the
`oven/bun` image, and GNU `-v` on a runner that has it — so the scenario reports it and no bound
depends on it.
