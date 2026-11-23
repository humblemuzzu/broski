/**
 * A listing's ranking, newest first, kept for a while after its first page: the pages after it read on from where the
 * last one stopped instead of listing every project directory and ranking every newer file again. The first page of a
 * listing always ranks afresh, so a new or moved session shows there at once; a session that moves while a person
 * pages only ever moves newer, to rows the catalog already sends the phone.
 */

import { isAfter, type Position } from "./enumerate";

const KEPT_MS = 30_000;
const MAX_KEPT = 16;

interface Kept<T extends Position> {
	readonly source: AsyncGenerator<T>;
	readonly ranked: T[];
	done: boolean;
	/** The ranking threw: its generator is over, so a later page ranks afresh rather than read it as done. */
	failed: boolean;
	usedAt: number;
}

export class RankedListings<T extends Position> {
	private readonly kept = new Map<string, Kept<T>>();

	constructor(private readonly now: () => number = Date.now) {}

	/**
	 * The ranked rows after `after`, newest first: `rank()` starts a new ranking for a first page, and for a later
	 * page whose listing is no longer kept.
	 */
	rows(key: string, after: Position | undefined, rank: () => AsyncGenerator<T>): AsyncGenerator<T> {
		const now = this.now();
		for (const [known, kept] of this.kept) if (now - kept.usedAt > KEPT_MS) this.kept.delete(known);
		let kept = after === undefined ? undefined : this.kept.get(key);
		if (kept === undefined || kept.failed) {
			kept = { source: rank(), ranked: [], done: false, failed: false, usedAt: now };
			this.kept.delete(key);
			this.kept.set(key, kept);
			if (this.kept.size > MAX_KEPT) this.kept.delete(this.kept.keys().next().value ?? key);
		}
		kept.usedAt = now;
		return readOn(kept, after);
	}
}

async function* readOn<T extends Position>(kept: Kept<T>, after: Position | undefined): AsyncGenerator<T> {
	for (let index = 0; ; index += 1) {
		while (index >= kept.ranked.length) {
			if (kept.done) return;
			const next = await kept.source.next().catch((error: unknown) => {
				kept.failed = true;
				throw error;
			});
			if (next.done === true) {
				kept.done = true;
				return;
			}
			kept.ranked.push(next.value);
		}
		const row = kept.ranked[index] as T;
		if (after === undefined || isAfter(row, after)) yield row;
	}
}
