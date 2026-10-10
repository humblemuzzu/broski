/**
 * Value-level primitives for scanning the head of one JSONL line without parsing it.
 *
 * Every reader works on the decoded head string, returns the index just past the value it consumed,
 * and never allocates for a value it only has to skip — which is what keeps a multi-megabyte tool
 * result cheap.
 */

export const QUOTE = 0x22;
export const BACKSLASH = 0x5c;
export const OPEN_OBJECT = 0x7b;
export const CLOSE_OBJECT = 0x7d;
export const OPEN_ARRAY = 0x5b;
export const CLOSE_ARRAY = 0x5d;
export const COLON = 0x3a;
export const COMMA = 0x2c;

export function isSpace(code: number): boolean {
	return code <= 0x20;
}

export function skipSpace(text: string, from: number): number {
	let index = from;
	while (index < text.length && isSpace(text.charCodeAt(index))) index++;
	return index;
}

/** Index just past the string that opens at `quoteAt`, or -1 when it does not close in `text`. */
export function endOfString(text: string, quoteAt: number): number {
	let from = quoteAt + 1;
	for (;;) {
		const quote = text.indexOf('"', from);
		if (quote === -1) return -1;
		let backslashes = 0;
		for (let index = quote - 1; index >= quoteAt && text.charCodeAt(index) === BACKSLASH; index--) backslashes++;
		if (backslashes % 2 === 0) return quote + 1;
		from = quote + 1;
	}
}

export type JsonString = { value: string; end: number };

/** Decodes a JSON string exactly, falling back to `JSON.parse` only when it carries escapes. */
export function readStringAt(text: string, quoteAt: number): JsonString | null {
	const end = endOfString(text, quoteAt);
	if (end === -1) return null;
	const raw = text.slice(quoteAt, end);
	if (!raw.includes("\\")) return { value: raw.slice(1, -1), end };
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "string" ? { value, end } : null;
	} catch {
		return null;
	}
}

/** Index just past the value that starts at `from`, or -1 when it runs past the end of `text`. */
export function skipValue(text: string, from: number): number {
	const code = text.charCodeAt(from);
	if (code === QUOTE) return endOfString(text, from);
	if (code === OPEN_OBJECT || code === OPEN_ARRAY) return skipContainer(text, from);

	let index = from;
	while (index < text.length) {
		const inner = text.charCodeAt(index);
		if (inner === COMMA || inner === CLOSE_OBJECT || inner === CLOSE_ARRAY || isSpace(inner)) break;
		index++;
	}
	return index;
}

function skipContainer(text: string, from: number): number {
	let depth = 0;
	let index = from;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code === QUOTE) {
			const end = endOfString(text, index);
			if (end === -1) return -1;
			index = end;
			continue;
		}
		if (code === OPEN_OBJECT || code === OPEN_ARRAY) depth++;
		else if (code === CLOSE_OBJECT || code === CLOSE_ARRAY) {
			depth--;
			if (depth === 0) return index + 1;
		}
		index++;
	}
	return -1;
}

/**
 * Reads the value at `at` as a string. `resolved` is false when the value may not have ended inside
 * the head (a line longer than the head), so the caller knows to re-read the line.
 */
export type ScalarField = { end: number; resolved: boolean; value: string | null };

export function readStringField(text: string, at: number, headCompletesLine: boolean): ScalarField {
	const end = skipValue(text, at);
	if (end === -1) return { end, resolved: false, value: null };
	const settled = settledAt(end, text.length, headCompletesLine);
	if (text.charCodeAt(at) !== QUOTE) return { end, resolved: settled, value: null };
	const read = readStringAt(text, at);
	return { end, resolved: settled && read !== null, value: read?.value ?? null };
}

export type NumberField = { end: number; resolved: boolean; value: number | null };

/** Reads the value at `at` as a JSON number; a string or a literal resolves to `null`. */
export function readNumberField(text: string, at: number, headCompletesLine: boolean): NumberField {
	const end = skipValue(text, at);
	if (end === -1) return { end, resolved: false, value: null };
	const settled = settledAt(end, text.length, headCompletesLine);
	if (text.charCodeAt(at) === QUOTE) return { end, resolved: settled, value: null };
	const parsed = Number(text.slice(at, end));
	return { end, resolved: settled, value: Number.isFinite(parsed) ? parsed : null };
}

/**
 * A value ending exactly at the head boundary may be half of a multi-byte character, so it counts as
 * resolved only when the head is known to be the whole line.
 */
function settledAt(end: number, headLength: number, headCompletesLine: boolean): boolean {
	return headCompletesLine ? end <= headLength : end < headLength;
}
