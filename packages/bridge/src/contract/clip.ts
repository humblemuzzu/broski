/** The first `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return isHighSurrogate(text.charCodeAt(max - 1)) ? text.slice(0, max - 1) : text.slice(0, max);
}

/** The last `max` UTF-16 units of `text`, one fewer when the cut would split a surrogate pair. */
export function clipEnd(text: string, max: number): string {
	if (text.length <= max) return text;
	const start = text.length - max;
	return isLowSurrogate(text.charCodeAt(start)) ? text.slice(start + 1) : text.slice(start);
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc00 && unit <= 0xdfff;
}
