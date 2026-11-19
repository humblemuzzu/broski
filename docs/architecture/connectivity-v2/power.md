# link-power — OS power primitives

Crate `packages/link/power` (`broski-link-power`). Library only: it holds the OS handles and the
threads behind them, never a policy. The `broski-link` daemon decides when the machine must stay
awake and what to tell the relay about a sleep.

API: `PowerMonitor::start(sleep_grace: Duration, on_event)`, `AwakeAssertion::acquire(reason: &str)`,
`power_status() -> PowerStatus { on_ac, battery_percent }`, `PowerEvent::{WillSleep, DidWake}`,
`Error::{Unsupported, Os}`. `on_event` runs on a thread the monitor owns, so a slow handler never
blocks the caller.

## Platform support

Broski's desktop host is macOS-only. Non-macOS targets compile against `platform/unsupported.rs`
so cross-platform crates and the relay build cleanly.

| Primitive | macOS (IOKit) |
|---|---|
| `PowerMonitor` | `IORegisterForSystemPower` |
| Sleep grace | delay `IOAllowPowerChange` |
| `AwakeAssertion` | `IOPMAssertionCreateWithName` |
| `power_status` | `IOPowerSources` |

**macOS.** The monitor registers on a thread with its own `CFRunLoop`. `kIOMessageCanSystemSleep` is
allowed through at once (never vetoed). `kIOMessageSystemWillSleep` reports `WillSleep`, waits up to
`sleep_grace` for the handler through a rendezvous channel, then allows the sleep.
`kIOMessageSystemHasPoweredOn` reports `DidWake`. Drop stops the run loop from the caller's thread,
deregisters, destroys the notification port, closes the service and joins.

## Limits

- **Idle sleep only.** These are idle-sleep assertions, not system-sleep ones, and display sleep is
  never touched. Closing the lid on battery, `pmset sleepnow`, restart and shutdown all still take
  the machine down.
- **The grace is a delay, not a veto.** `kIOMessageCanSystemSleep` is always allowed; the
  non-abortable sleep is only held for `sleep_grace`. On macOS the kernel proceeds without an ack
  after about 30 s, so a longer grace buys nothing.
- **Nothing here wakes anything.** Wake-on-LAN is not handled: a sleeping machine is found again by
  the relay and the daemon, not by this crate.
- **No policy.** Battery floors, timers and how long to keep a working agent awake belong to the
  daemon; this crate never inspects the agent.
- **`power_status` is best effort.** macOS reads the internal battery's own description, so a
  desktop Mac reports all `None`.

## Manual sleep test

`tests/macos_power.rs::manual_sleep_watch` is `#[ignore]`d because it needs a real sleep. It prints
each event for 120 s. Not run: triggering it means putting this machine to sleep.

```bash
export CARGO_TARGET_DIR=packages/link/target
cd packages/link/power
cargo test -- --ignored --nocapture manual_sleep_watch   # leave it running
# in another terminal: pmset sleepnow      (or close the lid)
# wake the machine; expect   t+..s WillSleep   then   t+..s DidWake
```

## Verified

Apple M4 Pro, macOS 27.0.1. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and
`cargo test` are clean; the three `tests/macos_*.rs` binaries pass. `AwakeAssertion` is present in
`pmset -g assertions` as `PreventUserIdleSystemSleep named: "broski-link-power test assertion"` and
gone after drop; a live `PowerMonitor` accounts for exactly two threads and 50 start/stop cycles add
none; `power_status().on_ac` is `Some`.

The Linux and Windows modules were type-checked by pointing the macOS `#[path]` at each in turn and
running `cargo clippy --lib -- -D warnings` (their dependencies build on this host, but neither
target toolchain is installed, so `cargo check --target x86_64-unknown-linux-gnu` cannot run). The
bounded `stop` added since then has not been compiled here.
Neither module has ever been executed, and no sleep or wake event has reached this crate.
