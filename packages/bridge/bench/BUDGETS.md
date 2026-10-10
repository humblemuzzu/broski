# Perf budgets (synthetic subset)

`bench/budgets.ts` holds the bounds; `bench/check-budget.ts` applies them to a `bench/run.ts`
JSON run and exits 1 on any failure. CI runs only scenarios that need no developer data:

```bash
BENCH_SERVER_IDLE_MS=8000 BENCH_SOAK_DURATION_MS=10000 \
  bun bench/run.ts --out=/tmp/broski-bench.json \
    --filter=module-load,cc-synthetic-list-projects,cc-synthetic-list-sessions,stream-throughput,stream-stalled-client,server-idle,soak-sessions
bun bench/check-budget.ts /tmp/broski-bench.json
```

Scenarios that read `~/.pi`, `~/.codex` or `~/.claude` carry `requiresDatasets` in
`bench/lib/scenarios.ts` and are skipped automatically when the dataset is missing (a bare CI
runner has none).

## Measured values and the bounds

Measured on the development machine — Apple M4 Pro, 48 GiB RAM, macOS 27.0.1, bun 1.4.2, with
`BENCH_SERVER_IDLE_MS=8000 BENCH_SOAK_DURATION_MS=10000`. Bounds are ~1.5–2× the measured value
(looser for wall-time and CPU, which a shared runner swings the most).

| check | measured | bound |
| --- | --- | --- |
| `module-load.loadedSdkPackages` | `(none)` | must stay `(none)` |
| `module-load.peakRssBytes` | 30.5 MiB | ≤ 128 MiB |
| `module-load.wallMs` | 131 ms | ≤ 5000 ms |
| `cc-synthetic-list-projects.peakRssBytes` | 35.7 MiB | ≤ 256 MiB |
| `cc-synthetic-list-projects.coldMs` | 333 ms | ≤ 5000 ms |
| `cc-synthetic-list-sessions.peakRssBytes` | 846 MiB | ≤ 1600 MiB |
| `cc-synthetic-list-sessions.coldMs` | 1307 ms | ≤ 20 000 ms |
| `cc-synthetic-list-sessions.warmMs` | 176 ms | ≤ 6000 ms |
| `stream-throughput.c1_charsMin` / `c4_charsMin` | 2 400 000 | ≥ 2 400 000 (all 20 000×120 chars) |
| `stream-throughput.c1_p99Ms` / `c4_p99Ms` | 12 / 22 ms | ≤ 400 / 500 ms |
| `stream-throughput.c1_eventsPerSec` / `c4_eventsPerSec` | 2355 / 10 069 | ≥ 150 / 400 |
| `stream-stalled-client.stalledShedAtMs` | 58 ms | ≤ 5000 ms |
| `stream-stalled-client.rssGrowthMb` | +129 MiB | ≤ 700 MiB |
| `server-idle.peakSelfRssBytes` | 129 MiB | ≤ 400 MiB |
| `server-idle.rssDeltaBytes` | +0.5 MiB | ≤ 64 MiB |
| `server-idle.cpuPercent` | 0.38 % | ≤ 10 % |
| `soak-sessions.peakRssBytes` | 126 MiB | ≤ 400 MiB |
| `soak-sessions.rssDeltaBytes` | +2 MiB | ≤ 64 MiB |
| `soak-sessions.cpuMs` | 378 ms | ≤ 8000 ms |
| `soak-sessions.views` | 366 | ≥ 50 |

Time metrics use the shortened CI knobs; the full-length run (`BENCH_*` unset) reports
`server-idle` 60 s / `soak-sessions` 60 s with the same RSS and CPU bounds.
