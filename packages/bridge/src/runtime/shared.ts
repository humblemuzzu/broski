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
