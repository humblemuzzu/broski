import { createHash } from "node:crypto";
import type { JsonValue } from "../../src/contract";
import { byCodeUnits } from "./order";

/**
 * JSON with every object's keys in code-unit order, so two equal values print the same text in any
 * language. Built as text: an object would put integer-like keys first, in numeric order.
 */
export function canonicalJson(value: JsonValue): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	const entries = Object.entries(value)
		.filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
		.sort(([a], [b]) => byCodeUnits(a, b));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
