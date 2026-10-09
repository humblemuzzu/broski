/** Deduplicates concurrent work on the same key: callers joining mid-flight await the first run's promise. */
export function singleFlight<TKey, TValue>(
	inFlight: Map<TKey, Promise<TValue>>,
	key: TKey,
	run: () => Promise<TValue>,
): Promise<TValue> {
	const existing = inFlight.get(key);
	if (existing) return existing;

	const promise = Promise.resolve()
		.then(run)
		.finally(() => {
			inFlight.delete(key);
		});
	inFlight.set(key, promise);
	return promise;
}
