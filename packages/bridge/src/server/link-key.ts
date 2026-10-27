import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

/** The header the daemon puts on every upgrade it makes to the bridge's unix socket. */
export const LINK_KEY_HEADER = "x-broski-link-key";

const LINK_KEY_PATTERN = /^[0-9a-f]{64}$/;

export type LinkKeyCheck = { ok: true } | { ok: false; error: string };

/**
 * The key the daemon rewrote at its last start, or null when the file is missing or is not the 32
 * random bytes it should be.
 *
 * Read on every upgrade: it is 64 bytes, and a bridge that outlives a daemon restart has to follow
 * the new key without one of its own.
 */
export function readLinkKey(path: string): string | null {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8").trim().toLowerCase();
	} catch {
		return null;
	}
	return LINK_KEY_PATTERN.test(raw) ? raw : null;
}

/** Constant-time: the header the daemon sent equals the key this bridge was handed. */
export function linkKeyMatches(presented: string | null, expected: string): boolean {
	const value = presented?.trim().toLowerCase() ?? "";
	if (!LINK_KEY_PATTERN.test(value) || expected.length !== value.length) return false;
	return timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
}

/**
 * What a unix-socket upgrade must carry. A bridge started without a key file is the dev case and
 * keeps the unkeyed behaviour; with one, every upgrade owes the key.
 */
export function checkLinkKey(linkKeyFile: string | undefined, headers: Headers): LinkKeyCheck {
	if (!linkKeyFile) return { ok: true };
	const expected = readLinkKey(linkKeyFile);
	if (expected === null) return { ok: false, error: `Link key file ${linkKeyFile} is unreadable or malformed` };
	if (!linkKeyMatches(headers.get(LINK_KEY_HEADER), expected)) {
		return { ok: false, error: `Missing or wrong ${LINK_KEY_HEADER}` };
	}
	return { ok: true };
}
