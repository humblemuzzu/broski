/** Shortening a native string to a contract bound (`limits.ts`) without splitting a surrogate pair. */

/** The first `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clipStart(text: string, max: number): string {
	if (text.length <= max) return text;
	const last = text.charCodeAt(max - 1);
	return isHighSurrogate(last) ? text.slice(0, max - 1) : text.slice(0, max);
}

/** The last `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clipEnd(text: string, max: number): string {
	if (text.length <= max) return text;
	const first = text.charCodeAt(text.length - max);
	return isLowSurrogate(first) ? text.slice(text.length - max + 1) : text.slice(text.length - max);
}

/** `at`, or one before it when `at` falls between the halves of a surrogate pair. */
export function characterStart(text: string, at: number): number {
	return isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at)) ? at - 1 : at;
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc00 && unit <= 0xdfff;
}
