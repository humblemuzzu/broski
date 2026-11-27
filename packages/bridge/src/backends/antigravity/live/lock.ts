/**
 * `agy`'s presence locks: a terminal `agy` holds an exclusive `flock` on `presence/<sessionId>.lock` while it has a
 * conversation open, and warns another that opens it ("Conversation already open … Use /fork"). ACP takes none, so the
 * bridge takes it, through the bridge's `FileLock`, for every session it hosts (agy 1.5.18). These files are the one
 * thing of agy's the adapter touches.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../../../adapter-kit/error-text";
import type { FileLock, LockFile } from "../../../adapter-kit/ports";
import type { PresenceEvent } from "../../../adapter-kit/promotable-view";

/** A session id names a file here, so one that could name another path is no session of agy's. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const POLL_MS = 3_000;

export type Taken =
	| {
			readonly kind: "taken";
			readonly lock: LockFile;
			/** Lets the lock go for a session agy has none of, and the file with it when the bridge made it. */
			readonly discard: () => void;
	  }
	| { readonly kind: "held" }
	| { readonly kind: "failed"; readonly message: string };

export function isLockableId(sessionId: string): boolean {
	return SAFE_ID.test(sessionId);
}

export class PresenceLocks {
	/**
	 * The locks this bridge holds, by session: `flock` refuses a second descriptor of the same process as it refuses
	 * another process, so only this says a lock is the bridge's own.
	 */
	private readonly held = new Map<string, LockFile>();

	constructor(
		private readonly presenceDir: string,
		private readonly fileLock: FileLock,
	) {}

	/**
	 * Takes the session's lock and keeps it, making the file (0600) when no `agy` has yet; only for a session agy has, or
	 * one it is making, so the bridge leaves no file of a session that does not exist.
	 */
	take(sessionId: string): Taken {
		try {
			mkdirSync(this.presenceDir, { recursive: true, mode: 0o700 });
			const path = this.pathOf(sessionId);
			const made = !existsSync(path);
			const file = this.fileLock.open(path);
			if (!file.tryLock()) {
				file.release();
				return { kind: "held" };
			}
			const lock: LockFile = {
				tryLock: () => file.tryLock(),
				release: () => {
					if (this.held.get(sessionId) === lock) this.held.delete(sessionId);
					file.release();
				},
			};
			this.held.set(sessionId, lock);
			const discard = () => {
				if (made) removeFile(path);
				lock.release();
			};
			return { kind: "taken", lock, discard };
		} catch (error) {
			return { kind: "failed", message: `the bridge could not take agy's lock on the session: ${errorText(error)}` };
		}
	}

	/**
	 * Whether a process other than the bridge holds the lock now; one the bridge took is its own, loading or closing a
	 * session included. `flock` has no test that takes nothing, and a shared lock would meet the terminal's exclusive
	 * one all the same, so this takes the exclusive lock without waiting and lets it go in the same synchronous step:
	 * nothing is held across an await, and a terminal opening the session can meet it only within those two system
	 * calls. A session with no lock file has had no terminal on it.
	 */
	heldElsewhere(sessionId: string): boolean {
		if (this.held.has(sessionId)) return false;
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

/** Removed while the bridge still holds its lock, so no terminal has it open; a file that stays is only a lock file. */
function removeFile(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {}
}

/** Tells `listener` each time a terminal takes or lets go of the lock, looking every `everyMs` while it runs. */
export function watchLock(
	held: () => boolean,
	listener: (event: PresenceEvent) => void,
	initial: PresenceEvent,
	everyMs: number,
): () => void {
	let last = initial;
	const timer = setInterval(() => {
		const event: PresenceEvent = held() ? "active" : "idle";
		if (event === last) return;
		last = event;
		listener(event);
	}, everyMs);
	timer.unref();
	return () => clearInterval(timer);
}
