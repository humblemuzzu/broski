/**
 * The tool calls of a session file whose result carries a sub-run (`mapping/sub-runs.ts`), each a child session of
 * the file's session. Found by reading the file's tool results once and again only for what a file has grown by (an
 * append never moves an entry); a file that was rewritten, or replaced by another, is read afresh.
 */

import { rejected } from "../../../adapter-kit/rejections";
import { MAX_LIST_ITEMS, type Rejected, type SessionId } from "../../../contract";
import { childTitle } from "../mapping/child-summary";
import { type SubRun, subRunsOf } from "../mapping/sub-runs";
import { isCount } from "../mapping/usage";
import type { SessionEntry } from "./entries";
import { type EntrySpan, readEntries, type SessionFileIndex } from "./jsonl-reader";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

export interface ToolChild {
	readonly piToolCallId: string;
	readonly resultEntryId: string;
	readonly title: string;
	readonly at: number | undefined;
}

interface Scanned {
	readonly ino: number;
	scanned: number;
	lastEntryId: string | undefined;
	readonly children: ToolChild[];
}

const REMEMBERED_FILES = 32;
const READ_BATCH = 64;

export class ToolChildren {
	private readonly scans = new Map<string, Scanned>();
	private reading: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly index: SessionIndex,
		private readonly read: typeof readEntries = readEntries,
	) {}

	/** The children of the session's file, in file order, and the file they were read from. */
	async of(parentId: SessionId): Promise<{ file: SessionFileIndex; children: readonly ToolChild[] } | Rejected> {
		const head = await this.index.find(parentId);
		if (head === undefined) return rejected("not_found", `no Pi session ${parentId}`);
		const file = await openFileIndex(this.index, head.path);
		if (isRejection(file)) return file;
		return { file, children: await this.inTurn(file) };
	}

	/** The sub-runs of one child, read from the result entry. */
	async runsOf(file: SessionFileIndex, child: ToolChild): Promise<SubRun[]> {
		const position = file.byId.get(child.resultEntryId);
		const span = position === undefined ? undefined : file.entries[position];
		if (span === undefined) return [];
		const [entry] = await this.read(file, [span]);
		return entry?.type === "message" && entry.message.role === "toolResult" ? subRunsOf(entry.message.details) : [];
	}

	/** One scan at a time, so two callers never read the same entries twice into one list. */
	private inTurn(file: SessionFileIndex): Promise<readonly ToolChild[]> {
		const turn = this.reading.then(() => this.scan(file));
		this.reading = turn.catch(() => undefined);
		return turn;
	}

	private async scan(file: SessionFileIndex): Promise<readonly ToolChild[]> {
		const known = this.scans.get(file.path);
		const state = known !== undefined && stillTheSameFile(known, file) ? known : this.fresh(file);
		while (state.scanned < file.entries.length) {
			const batch = file.entries.slice(state.scanned, state.scanned + READ_BATCH);
			const room = MAX_LIST_ITEMS - state.children.length;
			if (room > 0) state.children.push(...(await this.childrenIn(file, batch)).slice(0, room));
			state.scanned += batch.length;
			state.lastEntryId = batch.at(-1)?.entryId;
		}
		return state.children;
	}

	/** The children among `batch`; a read that fails adds none of them, so the next scan reads the batch again. */
	private async childrenIn(file: SessionFileIndex, batch: readonly EntrySpan[]): Promise<ToolChild[]> {
		const entries = await this.read(file, batch);
		const found: ToolChild[] = [];
		for (const [offset, entry] of entries.entries()) {
			const span = batch[offset];
			const child = span === undefined || entry === undefined ? undefined : await this.childOf(file, span, entry);
			if (child !== undefined) found.push(child);
		}
		return found;
	}

	private fresh(file: SessionFileIndex): Scanned {
		const state: Scanned = { ino: file.stamp.ino, scanned: 0, lastEntryId: undefined, children: [] };
		this.scans.delete(file.path);
		this.scans.set(file.path, state);
		const oldest = this.scans.keys().next().value;
		if (this.scans.size > REMEMBERED_FILES && oldest !== undefined) this.scans.delete(oldest);
		return state;
	}

	private async childOf(file: SessionFileIndex, span: EntrySpan, entry: SessionEntry): Promise<ToolChild | undefined> {
		if (entry.type !== "message" || entry.message.role !== "toolResult") return undefined;
		if (subRunsOf(entry.message.details).length === 0) return undefined;
		const at = Date.parse(entry.timestamp);
		return {
			piToolCallId: entry.message.toolCallId,
			resultEntryId: entry.id,
			title: childTitle(entry.message.toolName, await this.argumentsOf(file, span, entry.message.toolCallId)),
			at: isCount(at) ? at : undefined,
		};
	}

	/** The arguments of the call a result answers: the nearest assistant message before it holds the call. */
	private async argumentsOf(file: SessionFileIndex, result: EntrySpan, piToolCallId: string): Promise<unknown> {
		const position = file.byId.get(result.entryId) ?? 0;
		for (let at = position - 1; at >= 0; at -= 1) {
			const span = file.entries[at];
			if (span === undefined || span.type !== "message" || (span.role !== undefined && span.role !== "assistant"))
				continue;
			const [entry] = await this.read(file, [span]);
			if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
			const call = entry.message.content?.find((block) => block.type === "toolCall" && block.id === piToolCallId);
			return call?.type === "toolCall" ? call.arguments : undefined;
		}
		return undefined;
	}
}

function stillTheSameFile(known: Scanned, file: SessionFileIndex): boolean {
	if (known.ino !== file.stamp.ino || known.scanned > file.entries.length) return false;
	return known.scanned === 0 || file.entries[known.scanned - 1]?.entryId === known.lastEntryId;
}
