The reconnect bug is fixed: the phone no longer sends its queued messages twice when it switches from the relay to Wi‑Fi. Both apps pass, and I checked it on the iPhone by turning Wi‑Fi off and on ten times.

## What was wrong

When the Wi‑Fi route won the race *after* the relay had already resumed, both routes replayed the outbound queue. The agent saw every message twice, and a second **Approve** could land on the wrong question.

## What I changed

1. **Replays now carry the route's generation.** `OutboundQueue::replay` ignores a replay from an older route, so only the winner sends (`packages/link/session/src/queue.rs:88`).
2. **The losing route is cancelled before it resumes.** It used to be cancelled after, which left a short window where both were live.
3. **A regression test forces the bad ordering.** It pauses the clock between the two resumes, so the race happens every run instead of one run in fifty.

```rust
pub fn replay(&mut self, generation: u64) -> Vec<Frame> {
    if generation < self.generation {
        return Vec::new();
    }
    self.generation = generation;
    self.pending.drain(..).collect()
}
```

## How the routes compare now

| Route | First message after a switch | Duplicates |
|---|---|---|
| Wi‑Fi | 0.4 s | none |
| Relay | 1.1 s | none |
| Wi‑Fi → relay → Wi‑Fi | 0.6 s | none |

### Not touched

The relay's own resume path was already correct, so I left it alone. The slow `hello` on a cold start (about 1.8 s over the relay) is a separate problem; the [connectivity notes](https://github.com/humblemuzzu/broski/blob/main/docs/architecture/connectivity-v2/link-session.md) say where it comes from.

Next, I can look at that cold-start `hello`.
