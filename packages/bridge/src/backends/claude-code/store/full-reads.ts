/**
 * Lane A · whole-chain reads, one at a time. A full read of a 50 MB transcript peaks near 900 MiB (D42), so two
 * phones asking for the same session share one read, and reads of different sessions queue instead of adding up.
 */

export class FullReads<T> {
	private readonly inflight = new Map<string, Promise<T>>();
	private tail: Promise<unknown> = Promise.resolve();

	/** Runs `work` after the reads before it; a caller asking for a `key` already being read gets that read. */
	run(key: string, work: () => Promise<T>): Promise<T> {
		const running = this.inflight.get(key);
		if (running !== undefined) return running;
		const started = this.tail.then(work, work);
		this.tail = started.catch(() => undefined);
		const tracked = started.finally(() => {
			if (this.inflight.get(key) === tracked) this.inflight.delete(key);
		});
		this.inflight.set(key, tracked);
		return tracked;
	}
}
