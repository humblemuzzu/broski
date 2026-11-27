/**
 * A session a terminal `agy` has open: watch-only, with no `control` and no `answer`, since ACP gives the bridge no
 * channel to a terminal's turn or its asks. Its history is the transcript's. It promotes itself to controllable once the
 * terminal lets go of the presence lock, and goes back to watching if the terminal takes it again before the phone
 * acts (`adapter-kit/promotable-view.ts`): the lock is looked at every few seconds while the view is open and not hosted.
 */

import { statSync } from "node:fs";
import { openPromotableView } from "../../../adapter-kit/promotable-view";
import {
	emptySnapshot,
	type OpenResult,
	type OpenSession,
	type Rejected,
	type SessionRef,
	type SessionSink,
} from "../../../contract";
import { watchLock } from "./lock";

export const WATCHING_NOTICE =
	"This conversation is open in a terminal `agy`. Quit it there, or use /fork, to send from the phone.";

/** What the view knows of the stored session: where agy keeps it, when it does. */
export interface WatchedSession {
	readonly cwd?: string;
}

export interface WatchDeps {
	readonly ref: SessionRef;
	/** Whether a terminal holds the lock; undefined while this bridge hosts the session itself. */
	readonly terminalHolds: () => boolean | undefined;
	readonly locate: () => Promise<WatchedSession | Rejected>;
	readonly openHosted: (sink: SessionSink) => Promise<OpenResult>;
	/** How often the lock is looked at. */
	readonly pollMs: number;
	readonly now: () => number;
}

export function openWatched(deps: WatchDeps, stored: WatchedSession, sink: SessionSink): Promise<OpenResult> {
	return openPromotableView(
		{
			ref: deps.ref,
			watchPresence: (listener) => watchLock(deps.terminalHolds, listener, "active", deps.pollMs),
			finishExited: async () => undefined,
			isTerminalActive: async () => deps.terminalHolds() === true,
			locate: deps.locate,
			promotable: (found) => found.cwd === undefined || isDirectory(found.cwd),
			dormantSnapshot: async () => emptySnapshot(),
			openWatch: async (_found, watchSink) => watchOnly(deps, watchSink),
			openHosted: deps.openHosted,
			hostedMethods: { compact: true, cancelQueued: false },
			now: deps.now,
		},
		stored,
		sink,
	);
}

/**
 * The notice goes out once the view is the session's: after `open` has resolved, and after a view going back to
 * watching has replaced its stream, both of which finish within the microtasks that follow.
 */
function watchOnly(deps: WatchDeps, sink: SessionSink): OpenResult {
	const snapshot = emptySnapshot();
	let closed = false;
	setTimeout(() => {
		if (!closed) sink.emit({ at: deps.now(), event: { type: "notice", level: "info", text: WATCHING_NOTICE } });
	}, 0);
	const session: OpenSession = {
		session: deps.ref,
		snapshot: () => snapshot,
		close: async () => {
			closed = true;
		},
	};
	return { status: "accepted", session, snapshot };
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
