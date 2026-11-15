/**
 * An escaped backslash, so the `u` after it is plain text, or a surrogate escape, which is captured.
 * `JSON.stringify` writes a valid pair as the character itself and a lone surrogate as a lower-case escape, so
 * every surrogate escape in its output is a lone one.
 */
const SURROGATE_ESCAPES = /\\\\|(\\ud[89a-f][0-9a-f]{2})/g;

const REPLACEMENT_ESCAPE = "\\ufffd";

/**
 * `JSON.stringify(value)` with every lone UTF-16 surrogate, in a value or a key, replaced by U+FFFD.
 * A strict parser (serde_json) refuses the escape of a lone surrogate, so the whole frame it sits in would be
 * lost. The replacement is as long as the escape, so measured sizes stay exact.
 */
export function wellFormedJson(value: unknown): string {
	return JSON.stringify(value).replace(SURROGATE_ESCAPES, (match, lone?: string) =>
		lone === undefined ? match : REPLACEMENT_ESCAPE,
	);
}
