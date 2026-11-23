import { type BackendId, type CatalogEvent, clip, type SessionSummary } from "../../contract";
import type { ObservedEvent } from "../../core/observer";
import { cwdBase, type LinkFeedRunsMessage, type LinkRunEntry } from "./format";

const TITLE_MAX = 80;
const MAX_TRACKED = 64;

interface TrackedRun {
	readonly backend: BackendId;
	readonly sessionId: string;
	title: string;
	phase: "working" | "needsYou";
	startedAt: number;
	updatedAt: number;
}

/**
 * Tracks every active session on the bridge (both open sessions and terminal sessions reported via
 * the catalog) and emits `link_runs` snapshots to the daemon whenever the live set or a run's
 * phase/title changes, so the daemon can update iOS Live Activities in the background.
 */
export class LinkRunsTracker {
	private readonly runs = new Map<string, TrackedRun>();
	private lastKey = "";

	constructor(private readonly deliver: (message: LinkFeedRunsMessage) => void) {}

	reset(): void {
		this.runs.clear();
		this.lastKey = "";
	}

	current(): LinkFeedRunsMessage {
		return { type: "link_runs", runs: this.sortedEntries(), at: Date.now() };
	}

	observe(observed: ObservedEvent): void {
		const { session, event, after, at } = observed;
		const key = runKey(session.backend, session.sessionId);
		if (event.type === "session_replaced") {
			if (this.runs.delete(key)) this.emit(at);
			return;
		}
		const needsYou = after.interactions.some((interaction) => interaction.blocksRun);
		const runStart = after.run?.startedAt ?? after.compaction?.startedAt;
		if (!needsYou && runStart === undefined) {
			if (this.runs.delete(key)) this.emit(at);
			return;
		}
		const phase: "working" | "needsYou" = needsYou ? "needsYou" : "working";
		const existing = this.runs.get(key);
		if (existing) {
			const changed = existing.phase !== phase || (runStart !== undefined && existing.startedAt !== runStart);
			existing.phase = phase;
			if (runStart !== undefined) existing.startedAt = runStart;
			existing.updatedAt = Math.max(existing.updatedAt, at);
			if (changed) this.emit(at);
			return;
		}
		this.add(key, {
			backend: session.backend,
			sessionId: session.sessionId,
			title: "Untitled session",
			phase,
			startedAt: runStart ?? at,
			updatedAt: at,
		});
		this.emit(at);
		void observed.describe().then((summary) => {
			if (!summary) return;
			const current = this.runs.get(key);
			if (!current) return;
			const title = formatTitle(summary);
			if (title !== current.title) {
				current.title = title;
				this.emit(Date.now());
			}
		});
	}

	observeCatalog(event: CatalogEvent): void {
		if (event.type === "session_removed") {
			const key = runKey(event.session.backend, event.session.sessionId);
			if (this.runs.delete(key)) this.emit(Date.now());
			return;
		}
		if (event.type !== "session_updated") return;
		const { summary } = event;
		const key = runKey(summary.session.backend, summary.session.sessionId);
		if (summary.status !== "running" && summary.status !== "waiting_for_user") {
			if (this.runs.delete(key)) this.emit(Date.now());
			return;
		}
		const phase: "working" | "needsYou" = summary.status === "waiting_for_user" ? "needsYou" : "working";
		const title = formatTitle(summary);
		const startedAt = summary.runStartedAt ?? summary.updatedAt;
		const existing = this.runs.get(key);
		if (existing) {
			const changed = existing.phase !== phase || existing.title !== title || existing.startedAt !== startedAt;
			existing.phase = phase;
			existing.title = title;
			existing.startedAt = startedAt;
			existing.updatedAt = Math.max(existing.updatedAt, summary.updatedAt);
			if (changed) this.emit(Date.now());
			return;
		}
		this.add(key, {
			backend: summary.session.backend,
			sessionId: summary.session.sessionId,
			title,
			phase,
			startedAt,
			updatedAt: summary.updatedAt,
		});
		this.emit(Date.now());
	}

	private add(key: string, entry: TrackedRun): void {
		if (this.runs.size >= MAX_TRACKED) {
			const oldest = this.runs.keys().next();
			if (!oldest.done) this.runs.delete(oldest.value);
		}
		this.runs.set(key, entry);
	}

	private sortedEntries(): LinkRunEntry[] {
		return [...this.runs.values()]
			.sort((a, b) => {
				const phaseDiff = (a.phase === "needsYou" ? 0 : 1) - (b.phase === "needsYou" ? 0 : 1);
				if (phaseDiff !== 0) return phaseDiff;
				return b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId);
			})
			.map(({ backend, sessionId, title, phase, startedAt }) => ({
				backend,
				sessionId,
				title,
				phase,
				startedAt,
			}));
	}

	private emit(at: number): void {
		const runs = this.sortedEntries();
		const key = JSON.stringify(runs);
		if (key === this.lastKey) return;
		this.lastKey = key;
		this.deliver({ type: "link_runs", runs, at });
	}
}

function runKey(backend: BackendId, sessionId: string): string {
	return `${backend}::${sessionId}`;
}

function formatTitle(summary: SessionSummary): string {
	const raw = summary.title?.text?.replace(/\s+/g, " ").trim() || cwdBase(summary.cwd);
	if (!raw) return "Untitled session";
	return raw.length <= TITLE_MAX ? raw : `${clip(raw, TITLE_MAX - 1)}…`;
}
