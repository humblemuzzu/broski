import type { CoreClock } from "./ports";

/** How long the core waits for an adapter to open or close a session before it stops waiting. */
export const SESSION_CALL_DEADLINE_MS = 30_000;

/** `work`'s outcome, or `late()` once `ms` pass first. The timer goes as soon as `work` settles. */
export function within<T>(clock: CoreClock, ms: number, work: Promise<T>, late: () => T): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const cancel = clock.after(ms, () => resolve(late()));
		work.then(
			(value) => {
				cancel();
				resolve(value);
			},
			(error: unknown) => {
				cancel();
				reject(error);
			},
		);
	});
}

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly thrown: string };

/** What `call`, made now, came to, a throw included, whether it threw at once or later. */
export function settled<T>(call: () => Promise<T>): Promise<Settled<T>> {
	const threw = (error: unknown): Settled<T> => ({ ok: false, thrown: String(error) });
	let work: Promise<T>;
	try {
		work = call();
	} catch (error) {
		return Promise.resolve(threw(error));
	}
	return work.then((value): Settled<T> => ({ ok: true, value }), threw);
}
