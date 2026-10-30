/**
 * The tool calls of a session file whose result carries a sub-run (`mapping/sub-runs.ts`), each a child session of
 * the file's session. Found by reading the file's tool results once and again only for what a file has grown by (an
 * append never moves an entry); a file that was rewritten, or replaced by another, is read afresh.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MAX_LIST_ITEMS, type Rejected, type SessionId } from "../../../contract";
import { childTitle } from "../mapping/child-summary";
import { type SubRun, subRunsOf } from "../mapping/sub-runs";
import { isCount } from "../mapping/usage";
import { rejected } from "../rejections";
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

	constructor(private readonly index: SessionIndex) {}

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
		const [entry] = await readEntries(file, [span]);
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
		const spans = file.entries.slice(state.scanned);
		for (let at = 0; at < spans.length; at += READ_BATCH) {
			const batch = spans.slice(at, at + READ_BATCH);
			const entries = await readEntries(file, batch);
			for (const [offset, entry] of entries.entries()) {
				const span = batch[offset];
				if (span !== undefined && entry !== undefined) await this.note(file, span, entry, state.children);
			}
		}
		state.scanned = file.entries.length;
		state.lastEntryId = file.entries.at(-1)?.entryId;
		return state.children;
	}

	private fresh(file: SessionFileIndex): Scanned {
		const state: Scanned = { ino: file.stamp.ino, scanned: 0, lastEntryId: undefined, children: [] };
		this.scans.delete(file.path);
		this.scans.set(file.path, state);
		const oldest = this.scans.keys().next().value;
		if (this.scans.size > REMEMBERED_FILES && oldest !== undefined) this.scans.delete(oldest);
		return state;
	}

	private async note(
		file: SessionFileIndex,
		span: EntrySpan,
		entry: SessionEntry,
		children: ToolChild[],
	): Promise<void> {
		if (entry.type !== "message" || entry.message.role !== "toolResult" || children.length >= MAX_LIST_ITEMS) return;
		if (subRunsOf(entry.message.details).length === 0) return;
		const at = Date.parse(entry.timestamp);
		children.push({
			piToolCallId: entry.message.toolCallId,
			resultEntryId: entry.id,
			title: childTitle(entry.message.toolName, await this.argumentsOf(file, span, entry.message.toolCallId)),
			at: isCount(at) ? at : undefined,
		});
	}

	/** The arguments of the call a result answers: the nearest assistant message before it holds the call. */
	private async argumentsOf(file: SessionFileIndex, result: EntrySpan, piToolCallId: string): Promise<unknown> {
		const position = file.byId.get(result.entryId) ?? 0;
		for (let at = position - 1; at >= 0; at -= 1) {
			const span = file.entries[at];
			if (span === undefined || span.type !== "message" || (span.role !== undefined && span.role !== "assistant"))
				continue;
			const [entry] = await readEntries(file, [span]);
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
