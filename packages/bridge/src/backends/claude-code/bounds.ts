/**
 * Shortening what the SDK hands over to the contract's bounds (`contract/limits.ts`): strings without splitting a
 * surrogate pair, lists and maps to a count with the rest counted. Ids are never shortened: an id that does not fit is
 * not this adapter's to use (`fitsId`), since a cut id would name something else.
 */

import { clip, MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../contract";

export { clip } from "../../contract";

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
