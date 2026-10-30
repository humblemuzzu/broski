/**
 * The per-session mutex (D2): work on one session runs one at a time, in arrival order. Pi serializes
 * none of prompt, switch, compact, navigate or dispose itself.
 */

export class SessionLocks {
	/** The settle of the last work queued per session; an entry leaves once its work is the last and done. */
	private readonly tails = new Map<string, Promise<void>>();

	/** Runs `work` once every earlier work on `sessionId` has settled; resolves or rejects with it. */
	run<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
		const before = this.tails.get(sessionId) ?? Promise.resolve();
		const result = before.then(work);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(sessionId, tail);
		void tail.then(() => {
			if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
		});
		return result;
	}
}
