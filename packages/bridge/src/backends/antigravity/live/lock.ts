/**
 * `agy`'s presence locks: a terminal `agy` holds an exclusive `flock` on `presence/<sessionId>.lock` while it has a
 * conversation open, and warns another that opens it ("Conversation already open … Use /fork"). ACP takes none, so the
 * bridge takes it, through the bridge's `FileLock`, for every session it hosts (agy 1.5.18). These files are the one
 * thing of agy's the adapter touches.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../../../adapter-kit/error-text";
import type { FileLock, LockFile } from "../../../adapter-kit/ports";
import type { PresenceEvent } from "../../../adapter-kit/promotable-view";

/** A session id names a file here, so one that could name another path is no session of agy's. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const POLL_MS = 3_000;

export type Taken =
	| { readonly kind: "taken"; readonly lock: LockFile }
	| { readonly kind: "held" }
	| { readonly kind: "failed"; readonly message: string };

export function isLockableId(sessionId: string): boolean {
	return SAFE_ID.test(sessionId);
}

export class PresenceLocks {
	constructor(
		private readonly presenceDir: string,
		private readonly fileLock: FileLock,
	) {}

	/** Takes the session's lock and keeps it, making the file (0600) when no `agy` has yet. */
	take(sessionId: string): Taken {
		try {
			mkdirSync(this.presenceDir, { recursive: true, mode: 0o700 });
			const file = this.fileLock.open(this.pathOf(sessionId));
			if (file.tryLock()) return { kind: "taken", lock: file };
			file.release();
			return { kind: "held" };
		} catch (error) {
			return { kind: "failed", message: `the bridge could not take agy's lock on the session: ${errorText(error)}` };
		}
	}

	/**
	 * Whether another process holds the lock now. `flock` has no test that takes nothing, and a shared lock would meet
	 * the terminal's exclusive one all the same, so this takes the exclusive lock without waiting and lets it go in the
	 * same synchronous step: nothing is held across an await, and a terminal opening the session can meet it only
	 * within those two system calls. A session with no lock file has had no terminal on it.
	 */
	heldElsewhere(sessionId: string): boolean {
		const path = this.pathOf(sessionId);
		if (!existsSync(path)) return false;
		try {
			const file = this.fileLock.open(path);
			const free = file.tryLock();
			file.release();
			return !free;
		} catch {
			return false;
		}
	}

	private pathOf(sessionId: string): string {
		return join(this.presenceDir, `${sessionId}.lock`);
	}
}

/**
 * Tells `listener` each time the lock changes hands, looking every `everyMs` while it runs; `held` is undefined while
 * the bridge itself holds the lock, which says nothing of a terminal.
 */
export function watchLock(
	held: () => boolean | undefined,
	listener: (event: PresenceEvent) => void,
	initial: PresenceEvent,
	everyMs: number,
): () => void {
	let last = initial;
	const timer = setInterval(() => {
		const now = held();
		if (now === undefined) return;
		const event: PresenceEvent = now ? "active" : "idle";
		if (event === last) return;
		last = event;
		listener(event);
	}, everyMs);
	timer.unref();
	return () => clearInterval(timer);
}
