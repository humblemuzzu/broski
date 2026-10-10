/**
 * Runs `task` over `items` with at most `limit` tasks in flight. Fail-fast: once a task rejects, no
 * further items start, in-flight tasks are awaited so no worker outlives the call, and the first
 * error is rethrown.
 */
export async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
	const iterator = items[Symbol.iterator]();
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const state: { failed: boolean; error: unknown } = { failed: false, error: undefined };

	const workers = Array.from({ length: workerCount }, async () => {
		for (let next = iterator.next(); !next.done; next = iterator.next()) {
			if (state.failed) return;
			try {
				await task(next.value);
			} catch (error) {
				if (!state.failed) {
					state.failed = true;
					state.error = error;
				}
				return;
			}
		}
	});

	await Promise.all(workers);
	if (state.failed) throw state.error;
}
