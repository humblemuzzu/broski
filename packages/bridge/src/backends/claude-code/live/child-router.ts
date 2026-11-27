/** A subagent's events (`MappedEvent.agentId`) to its child session (D20): a watch-only feed with a run of its own. */

import { LiveState } from "../../../adapter-kit/live-state";
import { rejected } from "../../../adapter-kit/rejections";
import {
	emptySnapshot,
	type OpenResult,
	type OpenSession,
	type RunOutcome,
	type SessionId,
	type SessionSink,
} from "../../../contract";
import { childRef } from "../ids";
import type { MappedEvent } from "../ports/mapping";
import type { LiveRow } from "../ports/store";

/** Feeds kept per host; past it the oldest feed whose agent is done goes. */
const MAX_FEEDS = 256;

interface ChildFeed {
	readonly state: LiveState;
	running: boolean;
}

export interface ChildRouterDeps {
	readonly parentId: () => SessionId;
	readonly now: () => number;
}

export class ChildRouter {
	private readonly feeds = new Map<string, ChildFeed>();

	constructor(private readonly deps: ChildRouterDeps) {}

	route(mapped: MappedEvent): void {
		const agentId = mapped.agentId;
		if (agentId === undefined || childRef(this.deps.parentId(), agentId) === undefined) return;
		const feed = this.feed(agentId);
		if (!feed.running) this.begin(feed);
		feed.state.emit(mapped.event, mapped.native);
	}

	/** The agent's task ended (`task_notification`): its child run ends with it. */
	taskEnded(taskId: string, status: "completed" | "failed" | "stopped"): void {
		const feed = this.feeds.get(taskId);
		if (feed?.running) this.end(feed, outcomeOfTask(status));
	}

	/** The parent's run ended, and with it every agent's. */
	endRuns(outcome: RunOutcome): void {
		for (const feed of this.feeds.values()) if (feed.running) this.end(feed, outcome);
	}

	reset(): void {
		this.feeds.clear();
	}

	row(agentId: string): LiveRow | undefined {
		const feed = this.feeds.get(agentId);
		return feed ? { status: feed.running ? "running" : "idle" } : undefined;
	}

	/** A view of the child that follows it live; the child may not have started yet. */
	view(agentId: string, sink: SessionSink): OpenResult {
		const sessionId = childRef(this.deps.parentId(), agentId);
		if (sessionId === undefined) return rejected("not_found", "no such subagent");
		const feed = this.feed(agentId);
		const snapshot = feed.state.attach(sink);
		const session: OpenSession = {
			session: { backend: "claude-code", sessionId },
			snapshot: () => feed.state.snapshot(),
			close: async () => feed.state.detach(sink),
		};
		return { status: "accepted", session, snapshot };
	}

	private feed(agentId: string): ChildFeed {
		const known = this.feeds.get(agentId);
		if (known) return known;
		if (this.feeds.size >= MAX_FEEDS) this.evict();
		const feed: ChildFeed = {
			state: new LiveState(emptySnapshot(), this.deps.now),
			running: false,
		};
		this.feeds.set(agentId, feed);
		return feed;
	}

	private evict(): void {
		for (const [agentId, feed] of this.feeds) {
			if (!feed.running && !feed.state.attached) {
				this.feeds.delete(agentId);
				return;
			}
		}
	}

	private begin(feed: ChildFeed): void {
		feed.running = true;
		feed.state.emit({
			type: "run_started",
			runId: crypto.randomUUID(),
			trigger: "system",
		});
	}

	private end(feed: ChildFeed, outcome: RunOutcome): void {
		feed.running = false;
		const runId = feed.state.snapshot().run?.runId;
		if (runId !== undefined) feed.state.emit({ type: "run_finished", runId, outcome });
	}
}

function outcomeOfTask(status: "completed" | "failed" | "stopped"): RunOutcome {
	if (status === "completed") return { kind: "completed" };
	if (status === "stopped") return { kind: "aborted" };
	return {
		kind: "error",
		error: { code: "unknown", message: "the subagent failed" },
	};
}
