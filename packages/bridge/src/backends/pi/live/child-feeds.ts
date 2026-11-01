/**
 * The children of a hosted session while their tool calls run. A subagent tool reports its sub-run through the
 * `details` of its updates and of its result (`mapping/sub-runs.ts`); each new message becomes events of a live
 * state of the child's own, which a phone that has the child open follows. The child's run starts with the first
 * message seen and ends with its tool call, after the result is stored, so the transcript the phone reads then holds it.
 */

import {
	emptySnapshot,
	type OpenResult,
	type RunOutcome,
	type SessionRef,
	type SessionSink,
	type SessionSummary,
	type ToolOutcome,
} from "../../../contract";
import { childSessionId, mintRunId } from "../ids";
import { childSummary, childTitle } from "../mapping/child-summary";
import { subRunEvents, type Told, unfinishedCalls } from "../mapping/sub-run-items";
import { type SubRun, subRunsOf } from "../mapping/sub-runs";
import type { LiveRow } from "../ports";
import { LiveState } from "./live-state";

export interface ChildFeedsDeps {
	readonly parent: () => SessionSummary;
	readonly now: () => number;
	/** A child appeared, or ended: the catalog's row for it. */
	readonly announce: (summary: SessionSummary) => void;
}

interface Feed {
	readonly piToolCallId: string;
	readonly ref: SessionRef;
	readonly title: string;
	readonly live: LiveState;
	readonly runId: string;
	readonly told: Told;
	runs: readonly SubRun[];
	finished: boolean;
}

const REMEMBERED_FEEDS = 256;

/** The child's run ends as the call that ran it did: a call that failed or was refused did not finish its work. */
function childOutcome(outcome: ToolOutcome): RunOutcome {
	switch (outcome) {
		case "completed":
			return { kind: "completed" };
		case "aborted":
			return { kind: "aborted" };
		case "failed":
			return { kind: "error", error: { code: "tool", message: "The subagent's tool call failed." } };
		case "denied":
			return { kind: "error", error: { code: "tool", message: "The subagent's tool call was denied." } };
	}
}

export class ChildFeeds {
	private readonly feeds = new Map<string, Feed>();

	constructor(private readonly deps: ChildFeedsDeps) {}

	/**
	 * The call's `details` as they stand: the sub-runs in them reach the child. The child's session once it has any,
	 * else undefined (the call is not a subagent, or has not shown a message yet).
	 */
	link(piToolCallId: string, toolName: string, args: unknown, details: unknown): SessionRef | undefined {
		const runs = subRunsOf(details);
		const known = this.feeds.get(piToolCallId);
		const feed = known ?? (runs.length === 0 ? undefined : this.begin(piToolCallId, childTitle(toolName, args)));
		if (feed === undefined || feed.finished) return feed?.ref;
		if (runs.length > 0) {
			feed.runs = runs;
			for (const event of subRunEvents(runs, feed.told)) feed.live.emit(event);
		}
		return feed.ref;
	}

	end(piToolCallId: string, outcome: ToolOutcome): void {
		const feed = this.feeds.get(piToolCallId);
		if (feed === undefined || feed.finished) return;
		for (const toolCallId of unfinishedCalls(feed.runs)) {
			feed.live.emit({
				type: "tool_finished",
				toolCallId,
				outcome: "aborted",
				result: { content: [], fileChanges: [], error: "The tool call did not finish." },
			});
		}
		feed.live.emit({ type: "run_finished", runId: feed.runId, outcome: childOutcome(outcome) });
		feed.finished = true;
		this.announce(feed, "idle");
	}

	/** What a list and a transcript read need of a child this feed knows: whether it is under way. */
	row(childId: string): LiveRow | undefined {
		for (const feed of this.feeds.values()) {
			if (feed.ref.sessionId === childId)
				return feed.finished ? { status: "idle" } : { status: "running", cut: { leafEntryId: null } };
		}
		return undefined;
	}

	/** The rows of the children still under way. */
	unwritten(): SessionSummary[] {
		const rows: SessionSummary[] = [];
		for (const feed of this.feeds.values()) {
			const row = feed.finished ? undefined : this.summaryOf(feed, "running");
			if (row !== undefined) rows.push(row);
		}
		return rows;
	}

	/** A view of the child that follows its events; undefined when this feed never saw the call. */
	open(piToolCallId: string, sink: SessionSink): OpenResult | undefined {
		const feed = this.feeds.get(piToolCallId);
		if (feed === undefined) return undefined;
		const snapshot = feed.live.attach(sink);
		return {
			status: "accepted",
			snapshot,
			session: { session: feed.ref, snapshot: () => feed.live.snapshot(), close: async () => feed.live.detach(sink) },
		};
	}

	private begin(piToolCallId: string, title: string): Feed | undefined {
		const sessionId = childSessionId(this.deps.parent().session.sessionId, piToolCallId);
		if (sessionId === undefined) return undefined;
		const live = new LiveState(emptySnapshot(), this.deps.now);
		const feed: Feed = {
			piToolCallId,
			ref: { backend: "pi", sessionId },
			title,
			live,
			runId: mintRunId(),
			told: [],
			runs: [],
			finished: false,
		};
		live.emit({ type: "run_started", runId: feed.runId, trigger: "system" });
		this.feeds.set(piToolCallId, feed);
		this.forgetFinished();
		this.announce(feed, "running");
		return feed;
	}

	/** Past the bound the oldest finished feeds go; a running one stays, or its call could never end it. */
	private forgetFinished(): void {
		for (const [id, feed] of this.feeds) {
			if (this.feeds.size <= REMEMBERED_FEEDS) return;
			if (feed.finished) this.feeds.delete(id);
		}
	}

	private announce(feed: Feed, status: "running" | "idle"): void {
		const summary = this.summaryOf(feed, status);
		if (summary !== undefined) this.deps.announce(summary);
	}

	private summaryOf(feed: Feed, status: "running" | "idle"): SessionSummary | undefined {
		return childSummary({
			parent: this.deps.parent(),
			piToolCallId: feed.piToolCallId,
			title: feed.title,
			updatedAt: this.deps.now(),
			status,
		});
	}
}
