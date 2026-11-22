import {
	type AgentBackend,
	clipEnd,
	type ForkPoint,
	MAX_PAGE_LIMIT,
	MAX_TEXT_CHARS,
	type NewSessionResult,
	type PromptInput,
	type Rejected,
	type SessionRef,
	type TranscriptItem,
} from "../contract";
import { BoundedMap } from "../state/bounded-map";
import { allowedDirectory } from "./directories";
import type { CoreClock, DirectoryPolicy } from "./ports";
import { rejected } from "./results";
import type { SessionHub } from "./session-hub";
import { sessionKey } from "./session-key";

/** UTF-16 units of one handoff, its tags included. */
export const MAX_HANDOFF_CHARS = 65_536;
/** Transcript pages read to find the fork point. */
const MAX_FORK_PAGES = 50;
const MAX_PENDING_HANDOFFS = 256;
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1_000;
const OPENING =
	"<broski_context_handoff>\nThis conversation goes on from another session. Its newest part, oldest first:\n";
const CLOSING = "\n</broski_context_handoff>";

/**
 * A fork for a backend that cannot fork: a new session in the same working directory whose first prompt carries the
 * conversation up to the fork point, as a bounded `<broski_context_handoff>` of its newest messages. The handoff waits
 * in memory for that first prompt, for a day at most.
 */
export class PortableFork {
	private readonly handoffs: BoundedMap<string, string>;

	constructor(
		private readonly hub: SessionHub,
		private readonly directories: DirectoryPolicy,
		clock: CoreClock,
	) {
		this.handoffs = new BoundedMap({ maxEntries: MAX_PENDING_HANDOFFS, ttlMs: HANDOFF_TTL_MS, now: () => clock.now() });
	}

	async fork(backend: AgentBackend, ref: SessionRef, at: ForkPoint | undefined): Promise<NewSessionResult> {
		const found = await backend.getSession(ref);
		if (found.status === "rejected") return found;
		const cwd = found.summary.cwd;
		if (cwd === undefined) return rejected("unsupported", "the session names no working directory to fork into");
		const directory = await allowedDirectory(this.directories, cwd);
		if (directory.status === "rejected") return directory;
		const items = await historyBefore(backend, ref, at);
		if (!Array.isArray(items)) return items;
		const created = await this.hub.create(backend, { cwd: directory.cwd });
		if (created.status === "accepted" && items.length > 0) {
			this.handoffs.set(sessionKey(created.session), handoffOf(items));
		}
		return created;
	}

	/** `input` with the session's pending handoff before its text; `input` itself when there is none or no room. */
	withHandoff(ref: SessionRef, input: PromptInput): PromptInput {
		const handoff = this.handoffs.get(sessionKey(ref));
		if (handoff === undefined || input.command !== undefined) return input;
		const text = `${handoff}\n\n${input.text}`;
		return text.length <= MAX_TEXT_CHARS ? { ...input, text } : input;
	}

	/** The session's first prompt was accepted with its handoff. */
	taken(ref: SessionRef): void {
		this.handoffs.delete(sessionKey(ref));
	}
}

/** The finished items before the fork point (through it, for `through`), newest first. */
async function historyBefore(
	backend: AgentBackend,
	ref: SessionRef,
	at: ForkPoint | undefined,
): Promise<TranscriptItem[] | Rejected> {
	const kept: TranscriptItem[] = [];
	let reached = at === undefined;
	let cursor: string | undefined;
	for (let page = 0; page < MAX_FORK_PAGES; page++) {
		const read = await backend.readTranscript(ref, { limit: MAX_PAGE_LIMIT, ...(cursor !== undefined && { cursor }) });
		if (read.status === "rejected") return read;
		for (const item of read.page.items) {
			if (!reached && item.id === at?.itemId) {
				reached = true;
				if (at.position === "before") continue;
			}
			if (reached) kept.push(item);
		}
		cursor = read.page.nextCursor;
		if (cursor === undefined) break;
	}
	return reached ? kept : rejected("not_found", `no finished transcript item ${at?.itemId} to fork at`);
}

/** The newest items that fit, whole but for the oldest of them, oldest first. */
function handoffOf(newestFirst: readonly TranscriptItem[]): string {
	const budget = MAX_HANDOFF_CHARS - OPENING.length - CLOSING.length;
	const lines: string[] = [];
	let used = 0;
	for (const item of newestFirst) {
		const line = lineOf(item);
		if (line === undefined) continue;
		const room = budget - used - 1;
		if (room <= 0) break;
		lines.push(line.length <= room ? line : clipEnd(line, room));
		used += Math.min(line.length, room) + 1;
	}
	return `${OPENING}${lines.reverse().join("\n")}${CLOSING}`;
}

function lineOf(item: TranscriptItem): string | undefined {
	switch (item.kind) {
		case "user_message":
			return `User: ${item.text}`;
		case "block":
			return item.block === "thinking" ? undefined : `Assistant: ${item.text}`;
		case "tool_call":
			return `Tool call: ${item.title ?? item.name}`;
		case "compaction":
			return item.summary === undefined ? undefined : `Earlier, compacted: ${item.summary}`;
		default:
			return undefined;
	}
}
