/**
 * Shortening what the SDK hands over to the contract's bounds (`contract/limits.ts`): strings without splitting a
 * surrogate pair, lists and maps to a count with the rest counted. Ids are never shortened: an id that does not fit is
 * not this adapter's to use (`fitsId`), since a cut id would name something else.
 */

import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../contract";

/** The first `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const last = text.charCodeAt(max - 1);
	return isHighSurrogate(last) ? text.slice(0, max - 1) : text.slice(0, max);
}

/** The last `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clipEnd(text: string, max: number): string {
	if (text.length <= max) return text;
	const first = text.charCodeAt(text.length - max);
	return isLowSurrogate(first) ? text.slice(text.length - max + 1) : text.slice(text.length - max);
}

/** `text` clipped to `MAX_NAME_CHARS`, or `fallback` when it is empty: contract names are never empty. */
export function nameOr(text: string | undefined, fallback: string): string {
	const clipped = clip((text ?? "").trim(), MAX_NAME_CHARS);
	return clipped === "" ? clip(fallback, MAX_NAME_CHARS) : clipped;
}

/** A non-empty id within `MAX_ID_CHARS`. */
export function fitsId(id: string): boolean {
	return id.length > 0 && id.length <= MAX_ID_CHARS;
}

export interface Bounded<T> {
	readonly items: T[];
	/** How many were left out; the contract's `omitted`. */
	readonly omitted: number;
}

/** The first `max` items, and how many were left out. */
export function boundList<T>(items: readonly T[], max: number = MAX_LIST_ITEMS): Bounded<T> {
	return items.length <= max
		? { items: [...items], omitted: 0 }
		: { items: items.slice(0, max), omitted: items.length - max };
}

/**
 * The first `max` entries of `record` in insertion order, keys clipped to `MAX_NAME_CHARS` (a clipped key that repeats
 * an earlier one is dropped and counted). Own keys only, as pairs, so a `__proto__` key is kept like any other.
 */
export function boundRecord<V>(
	record: Readonly<Record<string, V>>,
	max: number = MAX_LIST_ITEMS,
): Bounded<[string, V]> {
	const kept: [string, V][] = [];
	const seen = new Set<string>();
	let omitted = 0;
	for (const [key, value] of Object.entries(record)) {
		const name = clip(key, MAX_NAME_CHARS);
		if (kept.length >= max || seen.has(name)) {
			omitted += 1;
			continue;
		}
		seen.add(name);
		kept.push([name, value]);
	}
	return { items: kept, omitted };
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc00 && unit <= 0xdfff;
}
