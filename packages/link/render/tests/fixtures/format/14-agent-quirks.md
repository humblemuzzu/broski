The CLI restarted mid-turn, so part of its prompt leaked into my answer:

<system-reminder>
The user has not changed the file since it was last read.
</system-reminder>

`★ Insight ─────────────────────────────────────`
**Why the second replay happened:** the relay route resumed *before* the LAN route was cancelled,
so both replayed the queue. In general:
1. Cancel the loser first.
2. Then resume.

```rust
assert!(generation >= queue.generation);
```
`─────────────────────────────────────────────────`

Summary
=======

The fix is two lines. The complexity is \(O(1)\) per frame, and the queue holds at most $k \le 64$
frames, so a replay costs nothing measurable.[^bench]

---

Things I did **not** do:

- [ ] Touch the relay
- [x] ~~Rewrite the route race~~ (not needed)
- [ ] Bump `broski-link-session` to `0.2.0`

> **Note**
> The paused-clock test needs `tokio` with the `test-util` feature.

[^bench]: Measured with `cargo bench -p broski-link-session` on an M4 Pro.
