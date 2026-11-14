/** Ids read off frames. The SDK types them as strings, but a frame is data from a process: only a string fits. */

import type { ToolCallId } from "../../../contract";
import { fitsId } from "../bounds";
import { toolCallId } from "../ids";

/** The value as an id (a string within `MAX_ID_CHARS`), or undefined. */
export function wireId(value: unknown): string | undefined {
	return typeof value === "string" && fitsId(value) ? value : undefined;
}

export function wireToolCallId(value: unknown): ToolCallId | undefined {
	const id = wireId(value);
	return id === undefined ? undefined : toolCallId(id);
}

/** A block index the API makes: a small non-negative integer. */
export function wireIndex(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1_000_000 ? value : undefined;
}
