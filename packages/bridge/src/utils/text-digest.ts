/**
 * The text progress a delta emitter needs to keep per message or part.
 *
 * Holding the full text of every message for the life of a tail is what the CC and OpenCode tails used
 * to do, and it grows without bound. A digest keeps a length and a hash instead, which is all the
 * "was this appended or replaced, and what is the suffix" question needs: a stored prefix matches when
 * the new text is at least as long and the hash of its first `length` characters equals the stored one.
 */

import { createHash } from "node:crypto";

export type TextDigest = { length: number; hash: string };

function hashText(text: string, upto?: number): string {
	const hash = createHash("sha256");
	hash.update(upto === undefined ? text : text.slice(0, upto));
	return hash.digest("hex");
}

export function digestText(text: string): TextDigest {
	return { length: text.length, hash: hashText(text) };
}

export function isSameText(digest: TextDigest, text: string): boolean {
	if (text.length !== digest.length) return false;
	return hashText(text) === digest.hash;
}

/** True when `text` starts with the text the digest was taken from, i.e. the update appended. */
export function extendsDigest(digest: TextDigest, text: string): boolean {
	if (text.length < digest.length) return false;
	if (digest.length === 0) return true;
	return hashText(text, digest.length) === digest.hash;
}

export function digestSuffix(digest: TextDigest, text: string): string {
	return text.slice(digest.length);
}
