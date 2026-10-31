/**
 * Files in transit, held by id. One goes when newer ones push the count past `kept` (the oldest first), when nobody
 * has used it for `idleMs`, or with all the others at `clear`. Idleness is checked at every use and by a timer that
 * keeps no process alive, so a transfer the phone abandoned is gone within twice `idleMs` even if no other comes.
 */

/** A phone moves a part every few seconds; a quarter of an hour without one is a transfer nobody will finish. */
export const TRANSFER_IDLE_MS = 15 * 60_000;

export interface HeldFilesOptions<V> {
	readonly kept: number;
	readonly idleMs: number;
	readonly now: () => number;
	/** Removes what `value` holds on disk. */
	readonly discard: (value: V) => Promise<void>;
	/** A value in use is never taken for being idle. */
	readonly inUse?: (value: V) => boolean;
}

interface Held<V> {
	readonly value: V;
	usedAt: number;
}

export class HeldFiles<V> {
	private readonly held = new Map<string, Held<V>>();
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly options: HeldFilesOptions<V>) {}

	/** The value held under `id`, marked used now. */
	use(id: string): V | undefined {
		this.sweep();
		const held = this.held.get(id);
		if (held === undefined) return undefined;
		held.usedAt = this.options.now();
		return held.value;
	}

	add(id: string, value: V): void {
		this.sweep();
		this.held.set(id, { value, usedAt: this.options.now() });
		for (const [oldest, held] of this.held) {
			if (this.held.size <= this.options.kept) break;
			this.drop(oldest, held);
		}
		if (this.timer === undefined) {
			this.timer = setInterval(() => this.sweep(), this.options.idleMs);
			this.timer.unref();
		}
	}

	/** Takes `id` out and removes its files. */
	async release(id: string): Promise<void> {
		const held = this.held.get(id);
		if (held === undefined) return;
		this.held.delete(id);
		await this.options.discard(held.value);
	}

	sweep(): void {
		const idleSince = this.options.now() - this.options.idleMs;
		for (const [id, held] of this.held) {
			if (held.usedAt <= idleSince && !this.options.inUse?.(held.value)) this.drop(id, held);
		}
		if (this.held.size === 0) this.stopTimer();
	}

	/** Forgets every value without touching the disk, for when the directory they live in goes whole. */
	clear(): void {
		this.held.clear();
		this.stopTimer();
	}

	private drop(id: string, held: Held<V>): void {
		this.held.delete(id);
		void this.options.discard(held.value).catch(() => undefined);
	}

	private stopTimer(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}
}
