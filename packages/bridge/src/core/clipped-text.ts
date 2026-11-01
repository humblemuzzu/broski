import { MAX_TEXT_CHARS } from "../contract";

/** `text` within the contract's text bound, never cut inside a surrogate pair. */
export function clipped(text: string): string {
	if (text.length <= MAX_TEXT_CHARS) return text;
	const cut = text.slice(0, MAX_TEXT_CHARS);
	const last = cut.charCodeAt(cut.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
