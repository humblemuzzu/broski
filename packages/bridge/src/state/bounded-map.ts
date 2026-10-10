/**
 * Long-lived server state in a daemon that runs for weeks: a `Map` that drops its least recently
 * used entries past a size cap and its untouched entries past a TTL.
 *
 * It is a `Map`, so callers keep iterating, spreading and passing it around unchanged. Entries are
 * evicted only when the cap or the TTL says so, and `onEvict` lets an owner release whatever the
 * value was holding (a watcher, a file handle, a listener).
 */

export type BoundedEvictReason = "capacity" | "ttl" | "clear";

export type BoundedMapOptions<K, V> = {
	/** Entries kept before the least recently used ones are dropped. */
	maxEntries: number;
	/** Entries untouched for this long are dropped by `sweep`. */
	ttlMs?: number;
	/** Move an entry to the most-recent end on `get`. Turn off for hot maps where order is not needed. */
	touchOnGet?: boolean;
	onEvict?: (key: K, value: V, reason: BoundedEvictReason) => void;
	/** Injectable clock, for tests. */
	now?: () => number;
};

export type BoundedMapStats = {
	size: number;
	maxEntries: number;
	ttlMs: number;
};

export class BoundedMap<K, V> extends Map<K, V> {
	private readonly stamps = new Map<K, number>();
	private readonly maxEntries: number;
	private readonly ttlMs: number;
	private readonly touchOnGet: boolean;
	private readonly onEvict: ((key: K, value: V, reason: BoundedEvictReason) => void) | undefined;
	private readonly clock: () => number;

	constructor(options: BoundedMapOptions<K, V>) {
		super();
		this.maxEntries = Math.max(1, options.maxEntries);
		this.ttlMs = options.ttlMs ?? 0;
		this.touchOnGet = options.touchOnGet ?? true;
		this.onEvict = options.onEvict;
		this.clock = options.now ?? Date.now;
	}

	override get(key: K): V | undefined {
		if (!super.has(key)) return undefined;
		const now = this.clock();
		if (this.isExpired(key, now)) {
			this.evict(key, "ttl");
			return undefined;
		}
		const value = super.get(key);
		this.stamps.set(key, now);
		if (this.touchOnGet) {
			super.delete(key);
			super.set(key, value as V);
		}
		return value;
	}

	override has(key: K): boolean {
		if (!super.has(key)) return false;
		if (this.isExpired(key, this.clock())) {
			this.evict(key, "ttl");
			return false;
		}
		return true;
	}

	override set(key: K, value: V): this {
		super.delete(key);
		super.set(key, value);
		this.stamps.set(key, this.clock());
		this.evictOverCapacity();
		return this;
	}

	override delete(key: K): boolean {
		this.stamps.delete(key);
		return super.delete(key);
	}

	override clear(): void {
		if (this.onEvict) {
			for (const [key, value] of this) this.onEvict(key, value, "clear");
		}
		this.stamps.clear();
		super.clear();
	}

	/** Drops every entry whose TTL has passed. Returns how many were dropped. */
	sweep(now: number = this.clock()): number {
		if (this.ttlMs <= 0) return 0;
		let dropped = 0;
		for (const key of [...this.stamps.keys()]) {
			if (!this.isExpired(key, now)) continue;
			this.evict(key, "ttl");
			dropped++;
		}
		return dropped;
	}

	stats(): BoundedMapStats {
		return { size: this.size, maxEntries: this.maxEntries, ttlMs: this.ttlMs };
	}

	private isExpired(key: K, now: number): boolean {
		if (this.ttlMs <= 0) return false;
		const stamp = this.stamps.get(key);
		return stamp !== undefined && now - stamp > this.ttlMs;
	}

	private evictOverCapacity(): void {
		while (this.size > this.maxEntries) {
			const oldest = this.keys().next().value;
			if (oldest === undefined) return;
			this.evict(oldest, "capacity");
		}
	}

	private evict(key: K, reason: BoundedEvictReason): void {
		const present = super.has(key);
		const value = super.get(key) as V;
		this.stamps.delete(key);
		super.delete(key);
		if (present) this.onEvict?.(key, value, reason);
	}
}

export type Sweepable = {
	name: string;
	sweep: (now?: number) => number;
	size: () => number;
	limit: () => number;
};

const sweepables = new Set<Sweepable>();

/** Registers a long-lived collection for the periodic sweep; returns the unregister function. */
export function registerSweepable(sweepable: Sweepable): () => void {
	sweepables.add(sweepable);
	return () => sweepables.delete(sweepable);
}

/** Sweeps every registered collection. Returns how many entries were dropped in total. */
export function sweepBoundedState(now: number = Date.now()): number {
	let dropped = 0;
	for (const sweepable of sweepables) dropped += sweepable.sweep(now);
	return dropped;
}

/** Sizes and caps of every registered collection, for leak checks in tests and benchmarks. */
export function boundedStateSizes(): Array<{ name: string; size: number; limit: number }> {
	return [...sweepables].map((sweepable) => ({
		name: sweepable.name,
		size: sweepable.size(),
		limit: sweepable.limit(),
	}));
}
