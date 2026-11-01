/** Work on one session runs one at a time, in arrival order; a failure of one never blocks the next. */
export class SerialLock {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(work: () => Promise<T>): Promise<T> {
		const result = this.tail.then(work);
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
