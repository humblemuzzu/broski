/** One job at a time per key, so two changes to the same thing from this bridge never interleave. */

const queues = new Map<string, Promise<unknown>>();

/** Runs `work` after every earlier job under `key`. */
export function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
	const turn = (queues.get(key) ?? Promise.resolve()).then(work, work);
	const tail = turn.catch(() => undefined);
	queues.set(key, tail);
	void tail.then(() => {
		if (queues.get(key) === tail) queues.delete(key);
	});
	return turn;
}
