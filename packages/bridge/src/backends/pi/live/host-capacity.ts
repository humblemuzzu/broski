/**
 * How many `pi` processes this bridge hosts at once. Each, with its holder, takes 140 MB on a bare agent dir and about
 * 250 MB with a person's extensions loaded (Pi README §1), and the core's cap per client does not bound them: more
 * phones, and sessions kept open for their work, multiply them.
 */

import { totalmem } from "node:os";
import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected } from "../../../contract";
import type { SessionHost } from "./session-host";
import type { SessionLocks } from "./session-lock";

const SESSION_BYTES = 250 * 1_048_576;
const MIN_HOSTED_SESSIONS = 8;
const MAX_HOSTED_SESSIONS = 32;

/** A tenth of the machine's memory at `SESSION_BYTES` each, between 8 and 32: 8 on 16 GB, 19 on 48 GB, 26 on 64 GB. */
export function defaultHostedSessions(memoryBytes: number = totalmem()): number {
	const fit = Math.floor(memoryBytes / 10 / SESSION_BYTES);
	return Math.min(MAX_HOSTED_SESSIONS, Math.max(MIN_HOSTED_SESSIONS, fit));
}

/**
 * Ends idle hosts, least recently used first, until a new `pi` fits. A view of an ended host starts a new one with its
 * next action (`SessionView`), showing what it showed meanwhile, which an idle host had nothing to add to; a host with
 * work in flight is never ended, so when all are busy the open is refused.
 */
export async function makeRoom(
	hosts: ReadonlyMap<string, SessionHost>,
	locks: SessionLocks,
	limit: number,
): Promise<Rejected | undefined> {
	while (hosts.size >= limit) {
		const victim = leastRecentlyUsedIdle(hosts.values(), locks);
		if (victim === undefined) {
			return rejected(
				"busy",
				`${limit} Pi sessions are running, each with work under way; let one finish or stop it, or raise pi.maxSessions in ~/.broski/config.json`,
			);
		}
		await locks.run(victim.sessionId, async () => {
			if (!victim.ended && victim.idle()) await victim.finish();
		});
	}
	return undefined;
}

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
