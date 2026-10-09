import type { JsonValue } from "@earendil-works/chord";

/** Keys and array items whose value is `undefined` are dropped, so the result is a JSON value. */
export function toJsonValue(value: unknown): JsonValue | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (Array.isArray(value)) {
		const items: JsonValue[] = [];
		for (const item of value) {
			const converted = toJsonValue(item);
			if (converted !== undefined) items.push(converted);
		}
		return items;
	}
	if (typeof value === "object") {
		const object: Record<string, JsonValue> = {};
		for (const [key, item] of Object.entries(value)) {
			const converted = toJsonValue(item);
			if (converted !== undefined) object[key] = converted;
		}
		return object;
	}
	return undefined;
}
