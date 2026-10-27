/**
 * The one place a list preview is cut to length: one pasted first message is enough to fill a link
 * frame, and the cut is on code points so a preview never ends in half a surrogate pair.
 */

export const SESSION_PREVIEW_MAX_CHARS = 280;

export const SESSION_PREVIEW_ELLIPSIS = "…";

/** [text], cut to at most [max] characters including the ellipsis that marks the cut. */
export function sessionPreview(text: string, max: number = SESSION_PREVIEW_MAX_CHARS): string {
	if (text.length <= max) return text;
	const head = Array.from(text.slice(0, max * 2)).slice(0, Math.max(0, max - 1));
	return `${head.join("")}${SESSION_PREVIEW_ELLIPSIS}`;
}
