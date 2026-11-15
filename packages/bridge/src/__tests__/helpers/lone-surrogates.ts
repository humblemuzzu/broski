import type { JsonValue } from "../../contract";

/**
 * Every string of the JSON `text`, keys included, that holds a lone UTF-16 surrogate once parsed: what a strict
 * parser refuses when `JSON.stringify` wrote it as an escape.
 */
export function loneSurrogates(text: string): string[] {
	const found: string[] = [];
	const walk = (value: JsonValue): void => {
		if (typeof value === "string") {
			if (!value.isWellFormed()) found.push(value);
		} else if (Array.isArray(value)) {
			for (const item of value) walk(item);
		} else if (value !== null && typeof value === "object") {
			for (const [key, item] of Object.entries(value)) {
				walk(key);
				walk(item);
			}
		}
	};
	walk(JSON.parse(text));
	return found;
}
