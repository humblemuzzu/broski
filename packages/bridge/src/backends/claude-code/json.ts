/**
 * Free values the SDK hands over (tool input, a tool's structured `tool_use_result`, MCP content) as contract
 * `JsonValue`, shortened to the bounds `contract/json.ts` checks instead of failing the event.
 */

import { type JsonValue, MAX_JSON_DEPTH, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../contract";
import { clip } from "./bounds";

/**
 * Strings are cut to `MAX_TEXT_CHARS`, lists and objects to `MAX_LIST_ITEMS` entries, keys to `MAX_NAME_CHARS`; what
 * JSON cannot hold (undefined, functions, symbols, bigints, non-finite numbers), a cycle, and anything nested past
 * `MAX_JSON_DEPTH` becomes `null`. A `__proto__` key stays an own key.
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
		if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
		const name = clip(key, MAX_NAME_CHARS);
		if (Object.hasOwn(result, name)) continue;
		// An assignment would make a `__proto__` key the prototype instead of an own key.
		Object.defineProperty(result, name, { value: bounded(item, depth + 1, path), enumerable: true, writable: true });
		kept += 1;
	}
	return result;
}

/** A plain object, for reading a field of an SDK value typed `unknown` without a cast. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
