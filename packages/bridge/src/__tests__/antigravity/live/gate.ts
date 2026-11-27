/**
 * Every test here runs the user's own `agy` on their own Google sign-in and spends their plan's quota, so each kind is
 * opt-in: the live suite and the conformance run with `BROSKI_TEST_AGY=1`, the terminal clash (which starts a terminal
 * `agy` in tmux) also needs `BROSKI_TEST_AGY_TERMINAL=1`, and the frame recorder runs only with `BROSKI_AGY_RECORD=1`.
 */

export const LIVE = process.env.BROSKI_TEST_AGY === "1";
export const TERMINAL = LIVE && process.env.BROSKI_TEST_AGY_TERMINAL === "1";
export const RECORD = process.env.BROSKI_AGY_RECORD === "1";

/** Long enough for a cold `agy acp` (about 2.6 s to its first session) and a real model's turn with a tool or two. */
export const TURN_MS = 120_000;
/** What one live test may take, every turn of it included. */
export const TEST_MS = 15 * 60_000;
