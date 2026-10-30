/**
 * Ending a hosted runtime without truncating it (D17): abort, wait for the run to settle, dispose, each within a
 * deadline. The deadlines add up to `HOST_END_BUDGET_MS`, inside the 5 s the bridge gives its whole teardown before
 * the process exits (`lifecycle/teardown.ts`, `DEFAULT_TEARDOWN_TIMEOUT_MS`), and every host ends at once.
 */

import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

/** A Stop from the phone: Pi's `abort()` awaits idle with no bound (pi-coding-agent `src/core/agent-session.ts`, `abort`). */
export const ABORT_DEADLINE_MS = 5_000;

/** How long an ending host waits for its extensions' `session_start` handlers to return. */
export const BINDING_WAIT_MS = 500;

/** How long an ending host waits for its aborted run to settle, so Pi persists what the run did. */
export const SETTLE_DEADLINE_MS = 2_500;

/** `runtime.dispose()` awaits every extension's `session_shutdown` handler, which nothing bounds (`src/core/agent-session-runtime.ts:404-411`). */
export const DISPOSE_DEADLINE_MS = 1_000;

export const HOST_END_BUDGET_MS = BINDING_WAIT_MS + SETTLE_DEADLINE_MS + DISPOSE_DEADLINE_MS;

/** The abort stays requested after a timeout. */
export async function boundedAbort(session: AgentSession, deadlineMs: number): Promise<"settled" | "timed_out"> {
	const aborting = new Promise<void>((resolve) => resolve(session.abort()));
	return within(
		aborting.then(() => "settled" as const),
		deadlineMs,
		"timed_out" as const,
	);
}

/**
 * Pi's `dispose()` alone stops persistence mid-run (it signals `agent.abort()` and disconnects at once,
 * `src/core/agent-session.ts:1412-1426`), so this aborts and waits first; the session is disposed whatever happens.
 */
export async function shutdownRuntime(runtime: AgentSessionRuntime): Promise<void> {
	await boundedAbort(runtime.session, SETTLE_DEADLINE_MS).catch(() => "failed" as const);
	const disposed = await within(
		runtime.dispose().then(
			() => "disposed" as const,
			() => "failed" as const,
		),
		DISPOSE_DEADLINE_MS,
		"timed_out" as const,
	);
	if (disposed !== "disposed") runtime.session.dispose();
}

/** `work`'s value, or `onDeadline` once `deadlineMs` pass first; the timer goes as soon as either settles. */
export async function within<T, U>(work: Promise<T>, deadlineMs: number, onDeadline: U): Promise<T | U> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<U>((resolve) => {
		timer = setTimeout(() => resolve(onDeadline), Math.max(0, deadlineMs));
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
}
