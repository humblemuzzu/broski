**Understanding the reconnect failure**

The test fails about one run in twenty. The log shows two `replay` calls for the same queue, 3 ms apart, one from the LAN route and one from the relay. So the queue is replayed twice and the bridge sees duplicate frames.

**Checking the route race**

Looking at `route_race.rs`, the loser is cancelled *after* `resume()` returns. That is the window. If I move the cancel before resume, the relay never replays.

**Plan**

1. Move the cancel.
2. Add the generation check as a second guard.
3. Write the paused-clock test.
