import { z } from "zod";
import { MAX_ID_CHARS, MAX_JSON_DEPTH, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Any JSON within the bounds, checked by one walk that stops at `MAX_JSON_DEPTH`. A recursive zod
 * schema would recurse once per level of the input and overflow the stack on a deep enough message.
 */
export const JsonValue = z.custom<JsonValue>((value) => isBoundedJson(value, 0), "not JSON within the bounds");

function isBoundedJson(value: unknown, depth: number): boolean {
	if (value === null || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "string") return value.length <= MAX_TEXT_CHARS;
	if (depth >= MAX_JSON_DEPTH || typeof value !== "object") return false;
	if (Array.isArray(value))
		return value.length <= MAX_LIST_ITEMS && value.every((item) => isBoundedJson(item, depth + 1));
	if (Object.getPrototypeOf(value) !== Object.prototype) return false;
	const entries = Object.entries(value);
	return (
		entries.length <= MAX_LIST_ITEMS &&
		entries.every(([key, item]) => key.length <= MAX_NAME_CHARS && isBoundedJson(item, depth + 1))
	);
}

/** Backend-native ids carried for debugging only. The app never keys anything on them. */
export const NativeIds = z
	.record(z.string().max(MAX_NAME_CHARS), z.string().max(MAX_ID_CHARS))
	.refine(fewKeys, "too many keys");
export type NativeIds = z.infer<typeof NativeIds>;

export function fewKeys<V>(record: Record<string, V>): boolean {
	return Object.keys(record).length <= MAX_LIST_ITEMS;
}
