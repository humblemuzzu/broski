/**
 * `readTranscript`, newest first and paged by position. A session the bridge hosts reads its host's own history
 * (`live/history.ts`). Any other reads what agy stored: a short job's `session/load` replay (`transcript-items.ts`), the
 * user messages this bridge sent given back their `clientRequestId` and images (`live/phone-prompts.ts`), kept while the
 * session's `updatedAt` stays the same and dropped when a host of it ends, its turns being newer than the replay.
 * Another agy's replay of a conversation can lack the latest turn of the worker that held it (README §6), so once agy
 * has closed a host's worker, that host's history stands in for a replay holding fewer of the person's messages, until
 * a replay holds as many. A session agy has not stored has no other history.
 */

import { cursorScope, decodeCursor, encodeCursor } from "../../../adapter-kit/cursor";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import type { JsonValue, PageRequest, Rejected, TranscriptItem, TranscriptReadResult } from "../../../contract";
import { AnyResult, isOffered } from "../acp/frames";
import type { RpcResult } from "../acp/rpc";
import type { JobContext, ShortJobs } from "../jobs";
import { loadSession } from "../live/load";
import type { PhonePrompts } from "../live/phone-prompts";
import type { ListedSession } from "./list";
import { type AgySessions, notFound } from "./sessions";

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

/** The history of each session the bridge hosts (`live/hosts.ts`). */
export interface HostedHistories {
	/** Its host's history, oldest first, once a host loading or closing it is done; undefined when none hosts it. */
	history(sessionId: string): Promise<readonly TranscriptItem[] | undefined>;
}

export class AgyTranscripts {
	private readonly kept = new Map<string, Kept>();
	/** The history of the host agy last closed, by session. */
	private readonly handed = new Map<string, readonly TranscriptItem[]>();

	constructor(
		private readonly jobs: ShortJobs,
		private readonly sessions: AgySessions,
		/** The `cwd` a session with none is loaded in: the folder agy reports for it. */
		private readonly voidDir: string,
		private readonly prompts: Pick<PhonePrompts, "restored">,
	) {}

	async read(sessionId: string, page: PageRequest, hosted: HostedHistories): Promise<TranscriptReadResult> {
		const scope = cursorScope(["transcript", sessionId]);
		const start = page.cursor === undefined ? undefined : decodeCursor(page.cursor, "transcript", scope, isPosition);
		if (page.cursor !== undefined && start === undefined) {
			return rejected("invalid_input", "this cursor was not minted by this transcript");
		}
		const items = (await hosted.history(sessionId)) ?? (await this.stored(sessionId));
		return isRejected(items) ? items : pageOf(items, page.limit, start, scope);
	}

	/** agy closed the session's worker; `history` is what its host had. */
	handOver(sessionId: string, history: readonly TranscriptItem[]): void {
		this.kept.delete(sessionId);
		remember(this.handed, sessionId, history);
	}

	/** A host of the session ended without agy closing it: what agy stored is its history. */
	forget(sessionId: string): void {
		this.kept.delete(sessionId);
		this.handed.delete(sessionId);
	}

	private async stored(sessionId: string): Promise<readonly TranscriptItem[] | Rejected> {
		const found = await this.sessions.find(sessionId);
		if (!found.ok) return rejected("backend_error", `Antigravity could not find the session: ${found.failure.message}`);
		if (found.result === undefined) return notFound(sessionId);
		const handed = this.handed.get(sessionId);
		if (found.result.unstored !== undefined) return handed ?? [];
		const replayed = await this.replayed(found.result);
		if (!replayed.ok) {
			return rejected("backend_error", `Antigravity could not load the session: ${replayed.failure.message}`);
		}
		const items = this.prompts.restored(sessionId, replayed.result);
		if (handed === undefined) return items;
		if (personMessages(items) < personMessages(handed)) {
			this.kept.delete(sessionId);
			return handed;
		}
		this.handed.delete(sessionId);
		return items;
	}

	private replayed(session: ListedSession): Promise<RpcResult<TranscriptItem[]>> {
		const known = this.kept.get(session.sessionId);
		if (known?.updatedAt === session.updatedAt) return known.items;
		const items = this.jobs.run((context) => replayedTranscript(context, session, session.cwd ?? this.voidDir));
		const kept = { updatedAt: session.updatedAt, items };
		remember(this.kept, session.sessionId, kept);
		void items.then((result) => {
			if (!result.ok && this.kept.get(session.sessionId) === kept) this.kept.delete(session.sessionId);
		});
		return items;
	}
}

export async function replayedTranscript(
	{ acp, agent }: JobContext,
	session: ListedSession,
	cwd: string,
): Promise<RpcResult<TranscriptItem[]>> {
	if (agent.agentCapabilities?.loadSession !== true) {
		return { ok: false, failure: { message: "this agy does not load sessions over ACP" } };
	}
	const { sessionId } = session;
	try {
		const { loaded, history } = await loadSession(acp.rpc, { sessionId, cwd, mcpServers: [] });
		return loaded.ok ? { ok: true, result: history.items(sessionId, session.updatedAt) } : loaded;
	} finally {
		if (isOffered(agent.agentCapabilities?.sessionCapabilities?.close)) {
			await acp.rpc.request("session/close", { sessionId }, AnyResult);
		}
	}
}

function pageOf(
	items: readonly TranscriptItem[],
	limit: number,
	start: Position | undefined,
	scope: string,
): TranscriptReadResult {
	const from = start === undefined ? items.length - 1 : start.i;
	if (start !== undefined && items[from]?.id !== start.a) {
		return rejected("stale", "the transcript changed since this cursor was minted; read it again");
	}
	const next = from - limit;
	const nextItem = items[next];
	return {
		status: "accepted",
		page: {
			items: items.slice(Math.max(0, from - limit + 1), from + 1).reverse(),
			...(nextItem !== undefined && { nextCursor: encodeCursor("transcript", scope, { i: next, a: nextItem.id }) }),
			idStability: "positional",
		},
	};
}

/** The messages with the person's words: agy replays no image, so one of images alone has none in a replay. */
function personMessages(items: readonly TranscriptItem[]): number {
	return items.filter((item) => item.kind === "user_message" && item.text !== "").length;
}

/** Sets `key` newest of the map's, which keeps the newest few. */
function remember<T>(map: Map<string, T>, key: string, value: T): void {
	map.delete(key);
	map.set(key, value);
	for (const oldest of map.keys()) {
		if (map.size <= REMEMBERED_TRANSCRIPTS) break;
		map.delete(oldest);
	}
}
