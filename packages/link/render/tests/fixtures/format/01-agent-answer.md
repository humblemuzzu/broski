## What I changed

I fixed the **flaky reconnect test** in `packages/link/client/tests/reconnect.rs`. The race was between the
resume timer and the route race: when the LAN route won *after* the relay had already resumed, both paths
tried to replay the outbound queue.

### The fix

1. `OutboundQueue::replay` now takes the route's generation, and ignores a replay for an older one.
2. The route race cancels the loser **before** it resumes, not after.
3. Added a regression test that forces the ordering with a paused clock.

```rust
pub fn replay(&mut self, generation: u64) -> Vec<Frame> {
    if generation < self.generation {
        return Vec::new();
    }
    self.generation = generation;
    self.pending.drain(..).collect()
}
```

### Verified

- `cargo test -p broski-client` passes 50 times in a row (`--test-threads=1`, then default)
- `cargo clippy --workspace --all-targets -- -D warnings` is clean
- The phone reattached in 0.4 s on the iPhone after toggling Wi‑Fi

> I did **not** touch the relay; its resume path was already correct.

Next, I can look at the slow `hello` on cold start — it takes ~1.8 s on the relay route.
