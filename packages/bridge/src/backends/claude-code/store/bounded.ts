/**
 * Keeping an insertion-ordered `Map` or `Set` to a size. Dropping the oldest one entry per insert is quadratic
 * in JavaScriptCore (each `keys().next()` walks the deleted slots before it: 150,000 inserts into a 20,000 set took 3.6 s),
 * so a collection may overshoot by `slack(max)` and is then cut back to `max` in one pass.
 */

interface Ordered<K> {
	readonly size: number;
	keys(): IterableIterator<K>;
	delete(key: K): boolean;
}

export function slack(max: number): number {
	return Math.max(16, max >> 3);
}

/** Deletes the oldest entries until `max` remain. */
export function trimOldest<K>(collection: Ordered<K>, max: number): void {
	let excess = collection.size - max;
	for (const key of collection.keys()) {
		if (excess-- <= 0) break;
		collection.delete(key);
	}
}

/** Cuts the collection back to `max` once it has grown past `max` plus the slack. */
export function boundedGrowth<K>(collection: Ordered<K>, max: number): void {
	if (collection.size > max + slack(max)) trimOldest(collection, max);
}
