import type { BackendId } from "../../contract";
import { BoundedMap, registerSweepable } from "../../state/bounded-map";
import { busyMessage, type LinkFeedEventMessage, type LinkFeedMessage } from "./format";
import type { LinkFeedRequest, LinkFeedRequests } from "./requests";

const MAX_TRACKED_SESSIONS = 512;
const SESSION_TTL_MS = 30 * 60 * 1000;

export const linkFeedTiming = {
	busyIdleDebounceMs: 3000,
	doneIdleMs: 5000,
};

/** The `done` alert of a session, built when it has stayed idle; undefined when the run's end is no news. */
export type DoneAlert = () => Promise<LinkFeedEventMessage | undefined>;

type SessionTrack = {
	busy: boolean;
	doneTimer: ReturnType<typeof setTimeout> | null;
	/** Set once the session's run ended; it speaks if the session stays idle. */
	doneAlert?: DoneAlert;
};

/**
 * The feed's view of the sessions the core has open: which are working (the machine is `busy` while any is, with
 * a debounce on the way back to idle), the `done` that follows a run once its session has stayed idle, and the
 * requests announced to the daemon.
 */
export class LinkFeedTracker {
	private readonly sessions: BoundedMap<string, SessionTrack>;
	private readonly workingSessions = new Set<string>();
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private busyState = false;

	constructor(
		private readonly deliver: (message: LinkFeedMessage) => void,
		private readonly requests: LinkFeedRequests,
	) {
		this.sessions = new BoundedMap<string, SessionTrack>({
			maxEntries: MAX_TRACKED_SESSIONS,
			ttlMs: SESSION_TTL_MS,
			touchOnGet: false,
			onEvict: (key, track) => this.release(key, track),
		});
		registerSweepable({
			name: "link-feed-sessions",
			sweep: (now) => this.sessions.sweep(now),
			size: () => this.sessions.size,
			limit: () => MAX_TRACKED_SESSIONS,
		});
	}

	/** The value a daemon feed must be told on connect. */
	currentBusy(): boolean {
		return this.busyState;
	}

	/**
	 * Re-sends every alert the daemon has not answered, byte for byte as it first went out, so a
	 * feed that redialled still shows the approvals that are waiting on the phone.
	 */
	replayPending(): void {
		for (const message of this.requests.pending()) this.deliver(message);
	}

	/** Forgets every tracked session and clears the debounce timers. */
	reset(): void {
		this.sessions.clear();
		this.requests.reset();
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		this.busyState = false;
	}

	/** Tells the daemon of a request once, and remembers it so a decision on it can be applied. */
	announce(
		backend: string,
		sessionId: string,
		requestId: string,
		request: LinkFeedRequest,
		message: LinkFeedEventMessage,
	): void {
		if (this.requests.announce(backend, sessionId, requestId, request, message)) this.deliver(message);
	}

	/** A session's run began. */
	runStarted(backend: BackendId, sessionId: string): void {
		const key = sessionKey(backend, sessionId);
		let track = this.sessions.get(key);
		if (!track) {
			track = { busy: false, doneTimer: null };
			this.sessions.set(key, track);
		}
		track.doneAlert = undefined;
		this.setWorking(key, track, true);
	}

	/** A session's run ended; `doneAlert` speaks once the session has stayed idle for `doneIdleMs`. */
	runEnded(backend: BackendId, sessionId: string, doneAlert: DoneAlert): void {
		const key = sessionKey(backend, sessionId);
		const track = this.sessions.get(key);
		if (!track) return;
		track.doneAlert = doneAlert;
		this.setWorking(key, track, false);
	}

	/** A session is no longer watched as one: no `done` follows, and it counts as idle. */
	forgetSession(backend: BackendId, sessionId: string): void {
		const key = sessionKey(backend, sessionId);
		const track = this.sessions.get(key);
		if (!track) return;
		this.release(key, track);
		this.sessions.delete(key);
	}

	/** The backend took a request back: no decision can reach it and a reconnecting feed is not told of it. */
	withdrawRequest(backend: string, sessionId: string, requestId: string): void {
		this.requests.withdraw(backend, sessionId, requestId);
	}

	private setWorking(key: string, track: SessionTrack, working: boolean): void {
		if (track.doneTimer) {
			clearTimeout(track.doneTimer);
			track.doneTimer = null;
		}

		if (working) {
			if (track.busy) return;
			track.busy = true;
			this.workingSessions.add(key);
			this.refreshBusy();
			return;
		}

		if (!track.busy) return;
		track.busy = false;
		this.workingSessions.delete(key);
		this.refreshBusy();
		track.doneTimer = setTimeout(() => {
			track.doneTimer = null;
			this.emitDone(key, track);
		}, linkFeedTiming.doneIdleMs);
	}

	private emitDone(key: string, track: SessionTrack): void {
		if (track.busy) return;
		this.sessions.delete(key);
		if (track.doneAlert) void this.deliverDone(track.doneAlert);
	}

	private async deliverDone(doneAlert: DoneAlert): Promise<void> {
		const message = await doneAlert();
		if (message) this.deliver(message);
	}

	private release(key: string, track: SessionTrack): void {
		if (track.doneTimer) {
			clearTimeout(track.doneTimer);
			track.doneTimer = null;
		}
		if (!this.workingSessions.delete(key)) return;
		this.refreshBusy();
	}

	private refreshBusy(): void {
		if (this.workingSessions.size > 0) {
			if (this.idleTimer) {
				clearTimeout(this.idleTimer);
				this.idleTimer = null;
			}
			this.setBusyState(true);
			return;
		}
		if (!this.busyState || this.idleTimer) return;
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			if (this.workingSessions.size > 0) return;
			this.setBusyState(false);
		}, linkFeedTiming.busyIdleDebounceMs);
	}

	private setBusyState(busy: boolean): void {
		if (this.busyState === busy) return;
		this.busyState = busy;
		this.deliver(busyMessage(busy));
	}
}

function sessionKey(backend: string, sessionId: string): string {
	return `${backend}::${sessionId}`;
}
