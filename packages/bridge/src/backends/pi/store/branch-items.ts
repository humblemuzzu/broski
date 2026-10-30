/**
 * The items of one branch of a session file, an entry at a time: only the entries a page walks are read,
 * and each is handed to the mapping with what lies beside it in the file that the mapping cannot see.
 */

import type { JsonObject } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { SessionRef, ToolCallId, TranscriptItem } from "../../../contract";
import { readPromptRecord, readToolOutcomeRecord } from "../broski-entries";
import { childSessionId, storedToolCallId } from "../ids";
import type { EntryContext } from "../mapping/message-items";
import { subRunsOf } from "../mapping/sub-runs";
import { type EntrySpan, readEntries, type SessionFileIndex } from "./jsonl-reader";

interface AnsweredCall {
	readonly toolCallId: ToolCallId;
	readonly input: JsonObject;
}

export type ItemsOfEntry = (entry: SessionEntry, context: EntryContext) => TranscriptItem[];

const PREFETCH_ENTRIES = 16;
const PREFETCH_BYTES = 4 * 1024 * 1024;
const CACHE_BYTES = 2 * PREFETCH_BYTES;
const RECORD_LOOK_AHEAD = 8;

export class BranchItems {
	/** Entries read so far, oldest use first, at most `CACHE_BYTES` of their lines: a page reads each entry once. */
	private readonly read = new Map<number, SessionEntry | undefined>();
	private readBytes = 0;

	/** `branch` is root first; a position in it is stable while the file only grows. */
	constructor(
		private readonly file: SessionFileIndex,
		readonly branch: readonly EntrySpan[],
		private readonly itemsOf: ItemsOfEntry,
	) {}

	positionOf(entryId: string): number {
		return this.branch.findIndex((span) => span.entryId === entryId);
	}

	/** The items of the entry at `position`, oldest first; none for an entry that cannot be read. */
	async itemsAt(position: number): Promise<TranscriptItem[]> {
		const entry = await this.entryAt(position, true);
		return entry === undefined ? [] : this.itemsOf(entry, await this.contextOf(position, entry));
	}

	/** With `prefetch`, the entries just below `position` are read with it, as a page walking down will want them next. */
	private async entryAt(position: number, prefetch: boolean): Promise<SessionEntry | undefined> {
		if (this.read.has(position)) {
			const entry = this.read.get(position);
			this.read.delete(position);
			this.read.set(position, entry);
			return entry;
		}
		const first = prefetch ? this.firstToRead(position) : position;
		const entries = await readEntries(this.file, this.branch.slice(first, position + 1));
		entries.forEach((entry, offset) => {
			this.keep(first + offset, entry);
		});
		return entries.at(-1);
	}

	private keep(position: number, entry: SessionEntry | undefined): void {
		if (this.read.has(position)) return;
		this.read.set(position, entry);
		this.readBytes += this.branch[position]?.length ?? 0;
		for (const oldest of this.read.keys()) {
			if (this.readBytes <= CACHE_BYTES || oldest === position) break;
			this.read.delete(oldest);
			this.readBytes -= this.branch[oldest]?.length ?? 0;
		}
	}

	private firstToRead(position: number): number {
		let first = position;
		let bytes = this.branch[position]?.length ?? 0;
		while (first > 0 && position - first + 1 < PREFETCH_ENTRIES) {
			bytes += this.branch[first - 1]?.length ?? 0;
			if (bytes > PREFETCH_BYTES) break;
			first -= 1;
		}
		return first;
	}

	private async contextOf(position: number, entry: SessionEntry): Promise<EntryContext> {
		if (entry.type !== "message") return {};
		const message = entry.message;
		if (message.role === "user") {
			const prompt = await this.recordAfter(position, readPromptRecord);
			return prompt === undefined ? {} : { prompt };
		}
		if (message.role === "assistant") return this.childLinks(position, message.content);
		if (message.role !== "toolResult") return {};
		const call =
			typeof message.toolCallId === "string" ? await this.callAnswered(position, message.toolCallId) : undefined;
		const toolOutcome = await this.recordAfter(position, readToolOutcomeRecord);
		return {
			...(call === undefined
				? { toolCallId: storedToolCallId(entry.id, 0) }
				: { toolCallId: call.toolCallId, toolInput: call.input }),
			...(toolOutcome !== undefined && { toolOutcome }),
		};
	}

	/**
	 * The calls of the assistant message at `position` that ran a sub-run, each with the child session it is: the
	 * results Pi appends after the message hold the sub-runs (`mapping/sub-runs.ts`).
	 */
	private async childLinks(
		position: number,
		content: readonly { readonly type: string }[] | undefined,
	): Promise<EntryContext> {
		const calls = new Set(
			(content ?? []).flatMap((block) => (block.type === "toolCall" && "id" in block ? [String(block.id)] : [])),
		);
		const childSessions = new Map<string, SessionRef>();
		for (let at = position + 1; at <= position + calls.size + RECORD_LOOK_AHEAD && calls.size > 0; at += 1) {
			const span = this.branch[at];
			if (span === undefined || (span.type === "message" && span.role !== undefined && span.role !== "toolResult"))
				break;
			if (span.type !== "message") continue;
			const result = await this.entryAt(at, false);
			if (result?.type !== "message" || result.message.role !== "toolResult") continue;
			const id = childSessionId(this.file.header.id, result.message.toolCallId);
			if (calls.has(result.message.toolCallId) && id !== undefined && subRunsOf(result.message.details).length > 0) {
				childSessions.set(result.message.toolCallId, { backend: "pi", sessionId: id });
			}
		}
		return childSessions.size === 0 ? {} : { childSessions };
	}

	/**
	 * The adapter's record of the message at `position` (`broski.prompt`, `broski.tool_outcome`), appended in the
	 * microtask after Pi persisted the message: next on the branch, after at most a few entries that are no message
	 * (`live/persisted-entry.ts`).
	 */
	private async recordAfter<T>(position: number, read: (entry: SessionEntry) => T | undefined): Promise<T | undefined> {
		for (let at = position + 1; at <= position + RECORD_LOOK_AHEAD; at += 1) {
			const span = this.branch[at];
			if (span === undefined || span.type === "message") return undefined;
			if (span.type !== "custom") continue;
			const entry = await this.entryAt(at, false);
			const record = entry === undefined ? undefined : read(entry);
			if (record !== undefined) return record;
		}
		return undefined;
	}

	/**
	 * The call a result answers: the nearest assistant message before it holds the call, because Pi appends
	 * a response's results after that message and before the next one. Nothing older is searched.
	 */
	private async callAnswered(position: number, piToolCallId: string): Promise<AnsweredCall | undefined> {
		for (let at = position - 1; at >= 0; at -= 1) {
			const span = this.branch[at];
			if (span?.type !== "message" || (span.role !== undefined && span.role !== "assistant")) continue;
			const entry = await this.entryAt(at, false);
			if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
			const content = entry.message.content;
			const index = Array.isArray(content)
				? content.findIndex((block) => block.type === "toolCall" && block.id === piToolCallId)
				: -1;
			const call = index < 0 ? undefined : content[index];
			return call?.type === "toolCall"
				? { toolCallId: storedToolCallId(entry.id, index), input: call.arguments }
				: undefined;
		}
		return undefined;
	}
}
