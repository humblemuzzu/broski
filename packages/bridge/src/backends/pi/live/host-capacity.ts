/**
 * How many `pi` processes this bridge hosts at once. Each takes about 110 MB (Pi README §1), and the core's cap per
 * client does not bound them: more phones, and sessions kept open for their work, multiply them.
 */

import type { SessionHost } from "./session-host";
import type { SessionLocks } from "./session-lock";

export const MAX_HOSTED_SESSIONS = 8;

/**
 * The host whose `pi` may end to make room: the least recently used of those with nothing in flight, even with a view
 * attached, since the view's next action starts a new one. A host whose session has work queued on its lock is skipped:
 * ending it would race that work, and waiting on its lock while the caller holds another could deadlock.
 */
export function leastRecentlyUsedIdle(hosts: Iterable<SessionHost>, locks: SessionLocks): SessionHost | undefined {
	let oldest: SessionHost | undefined;
	for (const host of hosts) {
		if (!host.isReady || host.ended || !host.idle() || !locks.isFree(host.sessionId)) continue;
		if (oldest === undefined || host.lastUsedAt < oldest.lastUsedAt) oldest = host;
	}
	return oldest;
}
