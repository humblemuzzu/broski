/** Ending a host: the idle grace (D1), and the deadline every wait on the CLI keeps (it answers nothing by itself). */

export const IDLE_GRACE_MS = 30_000;

/** A Stop's interrupt is answered by the CLI within this, or the process is ended (Stop means stop). */
export const INTERRUPT_DEADLINE_MS = 5_000;

/** How long an ending host waits for its consumer to see the process end. */
export const PROCESS_END_DEADLINE_MS = 2_500;

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
