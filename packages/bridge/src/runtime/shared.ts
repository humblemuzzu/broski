/**
 * Shared helpers used across runtime event mappers.
 * Consolidated from per-backend copies to one source of truth.
 */

/** Convert timestamps to milliseconds. Handles both seconds and milliseconds input. */
export function normalizeTimestampMs(value: number | undefined): number {
	if (!value || !Number.isFinite(value)) return 0;
	return value < 1_000_000_000_000 ? value * 1000 : value;
}

/** Trim and validate a string value. Returns undefined for empty/non-string. */
export function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Extract tool call ID from an item/part. Handles different SDK field naming conventions.
 * Field order: callId (Codex) → callID (OpenCode) → call_id → id.
 * Safe because no known SDK event sets both callId and callID simultaneously.
 */
export function extractToolCallId(source: any): string | undefined {
	const value = source?.callId ?? source?.callID ?? source?.call_id ?? source?.id;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
