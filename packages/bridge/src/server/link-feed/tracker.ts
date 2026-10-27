import { BoundedMap, registerSweepable } from "../../state/bounded-map";
import type {
	BroskiBackend,
	BroskiPermissionRequestedEvent,
	BroskiRuntimeEvent,
	BroskiRuntimeState,
	BroskiUserInputRequestedEvent,
} from "../../types/runtime";
import {
	approvalMessage,
	attentionMessage,
	busyMessage,
	doneMessage,
	firstLine,
	type LinkFeedEventMessage,
	type LinkFeedMessage,
} from "./format";
import type { LinkFeedRequests } from "./requests";

const MAX_TRACKED_SESSIONS = 512;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_ASSISTANT_TEXT = 400;

export const linkFeedTiming = {
	busyIdleDebounceMs: 3000,
	doneIdleMs: 5000,
};

type SessionTrack = {
	backend: BroskiBackend;
	sessionId: string;
	cwd?: string;
	busy: boolean;
	doneTimer: ReturnType<typeof setTimeout> | null;
	assistantText: string;
};

/** Turns the normalized runtime event stream of every backend into the daemon feed's messages. */
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

	handle(event: BroskiRuntimeEvent): void {
		if (event.replayed === true) return;
		const sessionId = event.sessionId?.trim() ?? "";

		if (event.type === "permission_requested") {
			this.emitRequest(event, sessionId, () =>
				approvalMessage(event.backend, sessionId, event.cwd, event.request, event.timestampMs),
			);
			return;
		}

		if (event.type === "user_input_requested") {
			this.emitRequest(event, sessionId, () =>
				attentionMessage(event.backend, sessionId, event.cwd, event.request, event.timestampMs),
			);
			return;
		}

		if (!sessionId) return;
		this.track(event, sessionId);
	}

	private emitRequest(
		event: BroskiPermissionRequestedEvent | BroskiUserInputRequestedEvent,
		sessionId: string,
		build: () => LinkFeedEventMessage,
	): void {
		const requestId = event.request.requestId;
		if (!requestId) {
			this.deliver(build());
			return;
		}
		const message = build();
		const announced = this.requests.announce(
			event.backend,
			sessionId,
			requestId,
			{
				kind: event.type === "permission_requested" ? "approval" : "attention",
				...(event.request.kind ? { requestKind: event.request.kind } : {}),
			},
			message,
		);
		if (announced) this.deliver(message);
	}

	private track(event: BroskiRuntimeEvent, sessionId: string): void {
		const key = `${event.backend}::${sessionId}`;

		if (event.type === "assistant_text_delta") {
			const textTrack = this.trackFor(key, event, sessionId);
			if (textTrack.assistantText.length < MAX_ASSISTANT_TEXT) {
				textTrack.assistantText = `${textTrack.assistantText}${event.delta}`.slice(0, MAX_ASSISTANT_TEXT);
			}
			return;
		}

		const working = workingOf(event);
		if (working === undefined) return;

		const track = this.trackFor(key, event, sessionId);
		if (working && event.type === "agent_started") track.assistantText = "";
		this.setWorking(key, track, working);
	}

	private trackFor(key: string, event: BroskiRuntimeEvent, sessionId: string): SessionTrack {
		const existing = this.sessions.get(key);
		if (existing) {
			if (event.cwd) existing.cwd = event.cwd;
			return existing;
		}
		const track: SessionTrack = {
			backend: event.backend,
			sessionId,
			cwd: event.cwd,
			busy: false,
			doneTimer: null,
			assistantText: "",
		};
		this.sessions.set(key, track);
		return track;
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
		const summary = firstLine(track.assistantText);
		track.assistantText = "";
		this.deliver(doneMessage(track.backend, track.sessionId, track.cwd, summary, Date.now()));
		this.sessions.delete(key);
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

function workingOf(event: BroskiRuntimeEvent): boolean | undefined {
	switch (event.type) {
		case "agent_started":
			return true;
		case "agent_finished":
			return false;
		case "session_state_changed":
			return stateWorking(event.state);
		default:
			return undefined;
	}
}

function stateWorking(state: BroskiRuntimeState): boolean {
	return state.isStreaming || state.isCompacting || state.isRetrying || (state.pendingMessageCount ?? 0) > 0;
}
