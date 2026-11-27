/**
 * Free values an agent hands over (tool arguments, tool details) as contract `JsonValue`, shortened to the
 * bounds `contract/json.ts` checks (README §2 rule 8, §15) instead of failing the event.
 */

import { clip, type JsonValue, MAX_JSON_DEPTH, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../contract";

/** A plain object an agent handed over, read field by field. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strings are cut to `MAX_TEXT_CHARS`, lists and objects to `MAX_LIST_ITEMS` entries, keys to
 * `MAX_NAME_CHARS`; what JSON cannot hold (undefined, functions, non-finite numbers) and anything
 * nested past `MAX_JSON_DEPTH` becomes `null`, as `JSON.stringify` would drop or null it.
 */
export function boundedJson(value: unknown): JsonValue {
	return bounded(value, 0, new Set());
}

function bounded(value: unknown, depth: number, path: Set<object>): JsonValue {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") return clip(value, MAX_TEXT_CHARS);
	if (typeof value !== "object" || depth >= MAX_JSON_DEPTH || path.has(value)) return null;
	path.add(value);
	const result = Array.isArray(value) ? boundedList(value, depth, path) : boundedObject(value, depth, path);
	path.delete(value);
	return result;
}

function boundedList(list: readonly unknown[], depth: number, path: Set<object>): JsonValue[] {
	return list.slice(0, MAX_LIST_ITEMS).map((item) => bounded(item, depth + 1, path));
}

function boundedObject(object: object, depth: number, path: Set<object>): { [key: string]: JsonValue } {
	const result: { [key: string]: JsonValue } = {};
	let kept = 0;
	for (const [key, item] of Object.entries(object)) {
		if (kept >= MAX_LIST_ITEMS) break;
		if (item === undefined || typeof item === "function") continue;
		const name = clip(key, MAX_NAME_CHARS);
		if (Object.hasOwn(result, name)) continue;
		// An assignment would make a `__proto__` key the prototype instead of an own key.
		Object.defineProperty(result, name, { value: bounded(item, depth + 1, path), enumerable: true, writable: true });
		kept += 1;
	}
	return result;
}
