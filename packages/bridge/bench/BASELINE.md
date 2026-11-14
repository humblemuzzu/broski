# Bridge performance baseline

Measured on the author's machine, so later changes are compared against numbers instead of guesses. The scenarios are
the ones in `bench/lib/scenarios.ts`; the bounds CI holds them to are in [`BUDGETS.md`](BUDGETS.md).

| | |
| --- | --- |
| Run | `bun bench/run.ts` (from `packages/bridge`) |
| Bun | 1.4.4 |
| macOS | 27.2.1 |
| CPU | Apple M4 Pro |
| RAM | 48 GiB |
| Caps | RSS 3072 MB, wall 120000 ms, RSS sample interval 100 ms |

## Method

* Every scenario runs in **its own child process** (`Bun.spawn` of `bench/scenarios/<name>.ts`).
  The runner samples the child's RSS every 100 ms with `ps -o rss= -p <pid>` (macOS reports KiB)
  and hard-kills it (`SIGKILL`, plus every descendant) when RSS passes the cap or the time cap
  expires. A kill is a result, not an error: `killed: "rss" | "time"` with the peak observed.
* `wall ms` in the table is the **child's whole lifetime** (bun boot + module load + measured work).
  Metrics named `wallMs` / `importMs` inside a scenario are the measured call only.
* `cpu ms` is `user + system` from the child's own `process.cpuUsage()` at exit. A value above the
  wall time means the scenario used more than one core.
* `peak RSS` is `max(sampled RSS, RSS reported at exit)`, so sub-100 ms scenarios still report a real
  number rather than zero.
* The kill path is proven by `bun bench/run.ts --selftest`, which must report `killed=rss` against a
  200 MB cap.
* Scenarios that could touch `~/.broski` run with `HOME` pointed at a fresh temp dir passed in the
  child's environment. `os.homedir()` reads `$HOME` at process start; assigning `process.env.HOME`
  after startup does **not** move it, so the runner supplies it at spawn time. The run reports
  `homeHonorsEnv: true`, `configPathUnderHome: true` and `broskiDirCreated: false`. The server starts
  with `BROSKI_TLS=0`, `port: 0`, an explicit auth token and a real WebSocket client, so no TLS
  material, token file or config is written.
* All agent data (`~/.pi`, `~/.claude`) is **read-only**. `bench/results/` is gitignored; this file is not.

## Results

| scenario | status | wall ms | peak RSS | cpu ms | metrics |
| --- | --- | --- | --- | --- | --- |
| `startup-version` | ok | 138 | 9.1 MiB | 13 | `bun src/index.ts version` → exit 0; spawn→exit 29 ms; `/usr/bin/time -l`: real 20 ms, maxRSS 33.2 MiB |
| `module-load` | ok | 140 | 32.7 MiB | 67 | `import ../src/server.ts` 22 ms, RSS 6.5 → 32.6 MiB (+26.2 MiB), no server started, no agent SDK loaded |
| `server-idle` | ok | 61115 | 64.0 MiB | 382 | 60 s idle: CPU 0.43 %, RSS 40.7 → 30.3 MiB, **0 child processes**, 1 client, no agent SDK loaded after the server or the client |
| `pty-main-thread-stall` | ok | 802 | 24.6 MiB | 48 | 3 idle native PTY sessions: JS-thread yield p99 0.01 ms (60 samples); echo round trip p50 0.22 ms, max 1.27 ms (15 samples) |

## Reading it

* **Idle is cheap.** `server-idle` burns under half a percent of a core over 60 s with zero child processes.
* **Startup is not a bottleneck.** 29 ms for `version`, and 22 ms to import `src/server.ts`, which loads no agent SDK:
  Claude Code and Pi are imported when a backend starts.
* **A PTY reader no longer blocks the JS thread.** The yield p99 with three idle sessions is 0.01 ms; the reader that
  waited in `poll(fd, 120)` on that thread held every await in the process for 121 ms per idle session
  (`BUDGETS.md`).

Treat RSS as ±40 % and wall time as ±10–20 %. Only compare a scenario against the same scenario, with the same caps.

## Re-running

```bash
cd packages/bridge
bun bench/run.ts --selftest                 # prove the RSS hard-kill works (200 MB cap)
bun bench/run.ts                            # full suite, default caps 3 GB / 120 s
bun bench/run.ts --filter=startup-version,module-load
bun bench/run.ts --cap-rss-mb=1024 --cap-time-ms=90000
```

Caps can be lowered freely; the runner clamps anything above 4096 MB.
