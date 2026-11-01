/**
 * The holds on open sessions (core README §20), counted by session key. A replaced session takes its holds with it,
 * and a release of the key a holder knows follows the move, however many replacements later.
 */

interface Moved {
	readonly to: string;
	/** Holds still known by the old key. */
	count: number;
}

export class Holds {
	private readonly counts = new Map<string, number>();
	private readonly moved = new Map<string, Moved>();

	has(key: string): boolean {
		return this.counts.has(key);
	}

	add(key: string): void {
		this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
	}

	/** One hold known by `key` ends, wherever the session it named is now; returns the key it ended on. */
	drop(key: string): string {
		let at = key;
		for (let moved = this.moved.get(at); moved !== undefined && !this.counts.has(at); moved = this.moved.get(at)) {
			moved.count -= 1;
			if (moved.count <= 0) this.moved.delete(at);
			at = moved.to;
		}
		const left = (this.counts.get(at) ?? 0) - 1;
		if (left > 0) this.counts.set(at, left);
		else this.counts.delete(at);
		return at;
	}

	/** The session `from` named goes on as `to`: its holds hold `to` now. */
	move(from: string, to: string): void {
		const count = this.counts.get(from);
		if (count === undefined) return;
		this.counts.delete(from);
		this.counts.set(to, (this.counts.get(to) ?? 0) + count);
		this.moved.set(from, { to, count });
	}
}
