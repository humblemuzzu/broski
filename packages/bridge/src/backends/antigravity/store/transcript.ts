/**
 * `readTranscript`: a session's history as agy replays it to a `session/load` (`transcript-items.ts`), newest first and
 * paged by position. A replay is kept while the session's `updatedAt` stays the same, or until the bridge knows it
 * changed. `live` is what the live layer makes of the items of a session it hosts: for one whose run is still active
 * they stop before the run, whose own items are in its snapshot. A session agy has not stored has no history.
 */

import { cursorScope, decodeCursor, encodeCursor } from "../../../adapter-kit/cursor";
import { rejected } from "../../../adapter-kit/rejections";
import type { JsonValue, PageRequest, TranscriptItem, TranscriptReadResult } from "../../../contract";
import { AnyResult, isOffered } from "../acp/frames";
import type { RpcResult } from "../acp/rpc";
import { type JobContext, jobRoute, type ShortJobs } from "../jobs";
import type { ListedSession } from "./list";
import { type AgySessions, notFound } from "./sessions";
import { ReplayItems } from "./transcript-items";

const REMEMBERED_TRANSCRIPTS = 8;

interface Kept {
	readonly updatedAt: number;
	readonly items: Promise<RpcResult<TranscriptItem[]>>;
}

type Position = { i: number; a: string };

function isPosition(value: JsonValue): value is Position & JsonValue {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof value.i === "number" &&
		Number.isSafeInteger(value.i) &&
		value.i >= 0 &&
		typeof value.a === "string"
	);
}

export class AgyTranscripts {
	private readonly kept = new Map<string, Kept>();

	constructor(
		private readonly jobs: ShortJobs,
		private readonly sessions: AgySessions,
		/** The `cwd` a session with none is loaded in: the folder agy reports for it. */
		private readonly voidDir: string,
	) {}

	async read(
		sessionId: string,
		page: PageRequest,
		live?: (items: readonly TranscriptItem[]) => readonly TranscriptItem[],
	): Promise<TranscriptReadResult> {
		const scope = cursorScope(["transcript", sessionId]);
		const start = page.cursor === undefined ? undefined : decodeCursor(page.cursor, "transcript", scope, isPosition);
		if (page.cursor !== undefined && start === undefined) {
			return rejected("invalid_input", "this cursor was not minted by this transcript");
		}
		const found = await this.sessions.find(sessionId);
		if (!found.ok) return rejected("backend_error", `Antigravity could not find the session: ${found.failure.message}`);
		if (found.result === undefined) return notFound(sessionId);
		if (found.result.unstored !== undefined)
			return { status: "accepted", page: { items: [], idStability: "positional" } };
		const replayed = await this.items(found.result);
		if (!replayed.ok)
			return rejected("backend_error", `Antigravity could not load the session: ${replayed.failure.message}`);
		const items = live === undefined ? replayed.result : live(replayed.result);
		const from = start === undefined ? items.length - 1 : start.i;
		if (start !== undefined && items[from]?.id !== start.a) {
			return rejected("stale", "the transcript changed since this cursor was minted; read it again");
		}
		const shown = items.slice(Math.max(0, from - page.limit + 1), from + 1).reverse();
		const next = from - page.limit;
		const nextItem = items[next];
		return {
			status: "accepted",
			page: {
				items: shown,
				...(nextItem !== undefined && { nextCursor: encodeCursor("transcript", scope, { i: next, a: nextItem.id }) }),
				idStability: "positional",
			},
		};
	}

	invalidate(sessionId: string): void {
		this.kept.delete(sessionId);
	}

	private items(session: ListedSession): Promise<RpcResult<TranscriptItem[]>> {
		const known = this.kept.get(session.sessionId);
		if (known?.updatedAt === session.updatedAt) return known.items;
		const items = this.jobs.run((context) => replayedTranscript(context, session, session.cwd ?? this.voidDir));
		const kept = { updatedAt: session.updatedAt, items };
		this.kept.delete(session.sessionId);
		this.kept.set(session.sessionId, kept);
		for (const oldest of this.kept.keys()) {
			if (this.kept.size <= REMEMBERED_TRANSCRIPTS) break;
			this.kept.delete(oldest);
		}
		void items.then((result) => {
			if (!result.ok && this.kept.get(session.sessionId) === kept) this.kept.delete(session.sessionId);
		});
		return items;
	}
}

/** agy replays the history as `session/update`s before it answers the load, so every item has arrived by then. */
export async function replayedTranscript(
	{ acp, agent }: JobContext,
	session: ListedSession,
	cwd: string,
): Promise<RpcResult<TranscriptItem[]>> {
	if (agent.agentCapabilities?.loadSession !== true) {
		return { ok: false, failure: { message: "this agy does not load sessions over ACP" } };
	}
	const { sessionId } = session;
	const replayed = new ReplayItems();
	const detach = acp.rpc.attach(
		sessionId,
		jobRoute(
			(update) => replayed.add(update),
			() => replayed.fault(),
		),
	);
	try {
		const loaded = await acp.rpc.request("session/load", { sessionId, cwd, mcpServers: [] }, AnyResult);
		return loaded.ok ? { ok: true, result: replayed.items(sessionId, session.updatedAt) } : loaded;
	} finally {
		detach();
		if (isOffered(agent.agentCapabilities?.sessionCapabilities?.close)) {
			await acp.rpc.request("session/close", { sessionId }, AnyResult);
		}
	}
}
