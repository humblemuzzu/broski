/** Work on one session id runs one at a time, in arrival order; an entry leaves once its work is the last and done. */
export class KeyedLock {
	private readonly tails = new Map<string, Promise<void>>();

	run<T>(key: string, work: () => Promise<T>): Promise<T> {
		const before = this.tails.get(key) ?? Promise.resolve();
		const result = before.then(work);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}
}
