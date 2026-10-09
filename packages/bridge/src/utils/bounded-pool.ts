/** Runs `task` over `items` with at most `limit` tasks in flight. */
export async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
	const iterator = items[Symbol.iterator]();
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers = Array.from({ length: workerCount }, async () => {
		for (let next = iterator.next(); !next.done; next = iterator.next()) {
			await task(next.value);
		}
	});
	await Promise.all(workers);
}
