/** Lane A · a newest-first transcript page (D18), ending before an active run (`LiveRow.cut`). */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PageRequest, Rejected, SessionId, TranscriptItem, TranscriptReadResult } from "../../../contract";
import type { LiveOverlay, StoredSession } from "../ports/store";
import { isRejected, rejected } from "../rejections";
import { finishedEnd } from "./chain-lookup";
import { type ChainSnapshot, openChain } from "./chain-reader";
import { sourceOf } from "./chain-sources";
import { childLinks } from "./children";
import type { StoreContext } from "./context";
import { itemsOf } from "./items";
import { contentList, resultBlockCount, toolCallOf } from "./message-parts";
import { ToolUseResults } from "./tool-use-results";
import type { TranscriptPosition } from "./transcript-cursor";
import { transcriptCursor, transcriptPosition, transcriptScope } from "./transcript-cursor";
import type { IndexEntry } from "./transcript-index";

const MIN_WINDOW = 32;
const MAX_WINDOW = 256;
const SPAWNING_TOOLS = new Set(["Agent", "Task"]);

export async function transcriptPage(
	ctx: StoreContext,
	sessionId: SessionId,
	page: PageRequest,
	live: LiveOverlay,
): Promise<TranscriptReadResult> {
	const scope = transcriptScope(sessionId);
	const resume = page.cursor === undefined ? undefined : transcriptPosition(page.cursor, scope);
	if (page.cursor !== undefined && resume === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this transcript");
	}
	const opened = await sourceOf(ctx, sessionId);
	if (isRejected(opened)) return opened;
	const snapshot = await openChain(ctx, opened.source);
	if (isRejected(snapshot)) return snapshot;
	const start = startOf(snapshot, live.row(sessionId)?.cut?.lastUuidBefore, resume);
	if (start === "stale") return rejected("stale", "the transcript changed since this cursor was minted; read it again");
	const owner = opened.isChild ? undefined : opened.owner;
	const results = new ToolUseResults(opened.source.path);
	const walked = await walk(ctx, { sessionId, snapshot, owner, results }, start, page.limit);
	if (isRejected(walked)) return walked;
	const { items, resumeAt } = walked;
	const nextCursor = resumeAt === undefined ? undefined : transcriptCursor(scope, resumeAt);
	return {
		status: "accepted",
		page: {
			items,
			...(nextCursor !== undefined && { nextCursor }),
			idStability: "stable",
		},
	};
}

interface Start {
	/** The entry to read first, going backwards; -1 when there is nothing to read. */
	readonly position: number;
	/** Of that entry, only its first `items` items are still to be shown. */
	readonly items: number | undefined;
}

/** Where a page begins: the end of the chain or of the finished runs, or where the cursor left off. */
function startOf(
	snapshot: ChainSnapshot,
	cutAt: string | null | undefined,
	resume: TranscriptPosition | undefined,
): Start | "stale" {
	const { index } = snapshot;
	const cut = finishedEnd(index, cutAt);
	if (resume === undefined) return { position: cut - 1, items: undefined };
	const at = index.positions.get(resume.uuid);
	if (at === undefined) return "stale";
	return at < cut ? { position: at, items: resume.items } : { position: cut - 1, items: undefined };
}

interface Walked {
	readonly items: TranscriptItem[];
	readonly resumeAt: TranscriptPosition | undefined;
}

interface Walk {
	readonly sessionId: SessionId;
	readonly snapshot: ChainSnapshot;
	/** The session whose subagents an `Agent` call links to; undefined inside a child's own transcript. */
	readonly owner: StoredSession | undefined;
	readonly results: ToolUseResults;
}

async function walk(ctx: StoreContext, job: Walk, start: Start, limit: number): Promise<Walked | Rejected> {
	const { index } = job.snapshot;
	const items: TranscriptItem[] = [];
	let links: Map<string, SessionId> | undefined;
	let position = start.position;
	let remaining = start.items;
	while (position >= 0) {
		const from = Math.max(0, position - Math.min(Math.max(limit - items.length, MIN_WINDOW), MAX_WINDOW) + 1);
		const window = await job.snapshot.window(from, position - from + 1);
		if (isRejected(window)) return window;
		if (job.owner !== undefined && links === undefined && spawns(window)) links = await childLinks(ctx, job.owner);
		for (let at = window.length - 1; at >= 0; at--) {
			const message = window[at];
			const entry = from + at;
			if (message === undefined) continue;
			const entryItems = itemsOf(message, {
				prompt: (sendUuid) => ctx.deps.ownership.prompt(job.sessionId, sendUuid),
				blockBase: index.blockBase[entry] ?? 0,
				toolName: (toolUseId) => index.toolNames.get(toolUseId),
				childOf: (toolUseId) => links?.get(toolUseId),
				toolUseResult: await resultOf(job, index, message),
				system: index.raw.system.get(message.uuid),
				previousSystem: index.raw.system.get(index.uuids[entry - 1] ?? ""),
			});
			for (let item = Math.min(entryItems.length, remaining ?? entryItems.length) - 1; item >= 0; item--) {
				const shown = entryItems[item];
				if (shown !== undefined) items.push(shown);
				if (items.length === limit) return { items, resumeAt: resumeAfter(job.snapshot, entry, item) };
			}
			remaining = undefined;
		}
		position = from - 1;
	}
	return { items, resumeAt: undefined };
}

/** The raw `toolUseResult` of an entry that answers exactly one tool call; a shared entry's would be ambiguous. */
async function resultOf(job: Walk, index: IndexEntry, message: SessionMessage): Promise<unknown> {
	const span = message.type === "user" ? index.raw.spans.get(message.uuid) : undefined;
	if (span === undefined || resultBlockCount(message) !== 1) return undefined;
	return job.results.read(message.uuid, span);
}

/** Where the page after one that ended on item `item` of entry `entry` resumes; undefined at the start of the chain. */
function resumeAfter(snapshot: ChainSnapshot, entry: number, item: number): TranscriptPosition | undefined {
	const { uuids } = snapshot.index;
	const here = uuids[entry];
	if (item > 0 && here !== undefined) return { uuid: here, items: item };
	const before = uuids[entry - 1];
	return before === undefined ? undefined : { uuid: before };
}

function spawns(window: readonly SessionMessage[]): boolean {
	return window.some((message) =>
		(contentList(message) ?? []).some((block) => {
			const call = toolCallOf(block);
			return call !== undefined && SPAWNING_TOOLS.has(call.name);
		}),
	);
}
