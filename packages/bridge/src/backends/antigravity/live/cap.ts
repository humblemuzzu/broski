/**
 * How many sessions are open in `agy` at once (`antigravity.maxSessions`). Each is a worker of about 190 MB beside the
 * front's 128 MB (`agy` 1.5.18, `--process-per-session`), and `session/close` ends a session's worker, so room is made
 * by closing the least recently used session with nothing in flight. One with work in flight is never closed: when
 * every session has some, a new one is refused.
 */

import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected } from "../../../contract";

export const DEFAULT_MAX_SESSIONS = 8;

export interface Evictable {
	readonly lastUsedAt: number;
	/** No run, ask, compaction or call under way. */
	idle(): boolean;
}

/** The session to close to make room, or none when every one has work in flight. */
export function evictionCandidate<T extends Evictable>(hosts: Iterable<T>): T | undefined {
	let oldest: T | undefined;
	for (const host of hosts) {
		if (!host.idle()) continue;
		if (oldest === undefined || host.lastUsedAt < oldest.lastUsedAt) oldest = host;
	}
	return oldest;
}

export function capacityRefusal(limit: number): Rejected {
	return rejected(
		"busy",
		`${limit} Antigravity sessions are open, each with work under way; let one finish or stop it, or raise antigravity.maxSessions in ~/.broski/config.json`,
	);
}
