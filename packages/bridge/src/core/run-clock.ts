import type { SessionRef, SessionSnapshot, SessionSummary, Timestamp } from "../contract";
import { BoundedMap } from "../state/bounded-map";
import type { CoreClock } from "./ports";
import type { SessionHub } from "./session-hub";
import { sessionKey } from "./session-key";

const MAX_TRACKED_RUNS = 512;
const RUN_TTL_MS = 24 * 60 * 60 * 1_000;

function isActiveStatus(status: SessionSummary["status"]): boolean {
	return status === "running" || status === "waiting_for_user";
}

function snapshotRunStart(snapshot: SessionSnapshot): Timestamp | undefined {
	return snapshot.run?.startedAt ?? snapshot.compaction?.startedAt;
}

/**
 * Bridge-wide single source of truth for each active session's `runStartedAt`.
 *
 * Every adapter benefits automatically without implementing run-start bookkeeping: open sessions
 * supply `snapshot.run.startedAt` directly, adapters may supply an earlier start (for a terminal
 * session already running before the bridge saw it), and otherwise the bridge stamps the transition
 * to active once and keeps it until the session settles.
 */
export class RunClock {
	private readonly started = new BoundedMap<string, Timestamp>({
		maxEntries: MAX_TRACKED_RUNS,
		ttlMs: RUN_TTL_MS,
		touchOnGet: false,
	});

	constructor(
		private readonly hub: SessionHub,
		private readonly clock: CoreClock,
	) {}

	observeEvent(ref: SessionRef, snapshot: SessionSnapshot): void {
		const key = sessionKey(ref);
		const start = snapshotRunStart(snapshot);
		if (start !== undefined) {
			this.started.set(key, start);
		} else if (snapshot.backgroundTasks.length === 0) {
			this.started.delete(key);
		}
	}

	replace(oldRef: SessionRef, newRef: SessionRef): void {
		const oldKey = sessionKey(oldRef);
		const existing = this.started.get(oldKey);
		if (existing === undefined) return;
		this.started.delete(oldKey);
		this.started.set(sessionKey(newRef), existing);
	}

	remove(ref: SessionRef): void {
		this.started.delete(sessionKey(ref));
	}

	enrich(summary: SessionSummary): SessionSummary {
		const key = sessionKey(summary.session);
		const live = this.hub.find(summary.session);
		const liveStart = live ? snapshotRunStart(live.snapshot) : undefined;
		if (!isActiveStatus(summary.status)) {
			if (liveStart === undefined) this.started.delete(key);
			if (summary.runStartedAt === undefined) return summary;
			const { runStartedAt: _dropped, ...settled } = summary;
			return settled;
		}
		const resolved = this.resolveStart(key, liveStart, summary.runStartedAt);
		return summary.runStartedAt === resolved ? summary : { ...summary, runStartedAt: resolved };
	}

	private resolveStart(key: string, liveStart: Timestamp | undefined, adapterStart: Timestamp | undefined): Timestamp {
		if (liveStart !== undefined) {
			this.started.set(key, liveStart);
			return liveStart;
		}
		if (adapterStart !== undefined) {
			this.started.set(key, adapterStart);
			return adapterStart;
		}
		const remembered = this.started.get(key);
		if (remembered !== undefined) return remembered;
		const stamped = this.clock.now();
		this.started.set(key, stamped);
		return stamped;
	}
}
