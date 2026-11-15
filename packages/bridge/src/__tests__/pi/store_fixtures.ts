/**
 * Session files as Pi writes them (key order included: the reader reads types and ids from a line's first
 * bytes), and an entry mapping that implements the frozen `itemsOfEntry` interface for the store tests.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entryAttachmentId, entryItemId, storedToolCallId } from "../../backends/pi/ids";
import type { EntryContext } from "../../backends/pi/mapping/message-items";
import { modelWireId } from "../../backends/pi/models/model-ids";
import type { SessionEntry } from "../../backends/pi/store/entries";
import type { TranscriptItem } from "../../contract";

export const T0 = Date.parse("2026-03-01T10:00:00.000Z");

export function iso(offsetMs: number): string {
	return new Date(T0 + offsetMs).toISOString();
}

export interface FixtureOptions {
	readonly id: string;
	readonly cwd: string;
	/** Absent for a v1 file. */
	readonly version?: 2 | 3;
	readonly createdAt?: number;
	readonly parentSession?: string;
}

/** Entries chained one after another, as Pi appends them; `at` is milliseconds after `T0`. */
export class SessionBuilder {
	readonly lines: object[] = [];
	private previous: string | null = null;
	private count = 0;

	constructor(readonly options: FixtureOptions) {
		this.lines.push({
			type: "session",
			...(options.version === undefined ? {} : { version: options.version }),
			id: options.id,
			timestamp: iso(options.createdAt ?? 0),
			cwd: options.cwd,
			...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
		});
	}

	/** Entry ids are `e0000001`, `e0000002`, … in file order, except in a v1 file, which has none. */
	private next(): { id: string; parentId: string | null } {
		this.count += 1;
		const id = `e${String(this.count).padStart(7, "0")}`;
		const parentId = this.previous;
		this.previous = id;
		return { id, parentId };
	}

	private push(entry: (ids: { id: string; parentId: string | null }) => object, v1Entry?: object): string {
		const ids = this.next();
		this.lines.push(this.options.version === undefined && v1Entry ? v1Entry : entry(ids));
		return ids.id;
	}

	user(text: string | readonly object[], at: number): string {
		const message = { role: "user", content: text, timestamp: T0 + at };
		return this.push(({ id, parentId }) => ({ type: "message", id, parentId, timestamp: iso(at), message }), {
			type: "message",
			timestamp: iso(at),
			message,
		});
	}

	assistant(content: readonly object[], at: number, model = "faux-1", provider = "faux"): string {
		const message = {
			role: "assistant",
			content,
			api: "faux",
			provider,
			model,
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: T0 + at,
		};
		return this.push(({ id, parentId }) => ({ type: "message", id, parentId, timestamp: iso(at), message }), {
			type: "message",
			timestamp: iso(at),
			message,
		});
	}

	toolResult(toolCallId: string, text: string, at: number, toolName = "read", details?: object): string {
		const message = {
			role: "toolResult",
			toolCallId,
			toolName,
			content: [{ type: "text", text }],
			...(details !== undefined && { details }),
			isError: false,
			timestamp: T0 + at,
		};
		return this.push(({ id, parentId }) => ({ type: "message", id, parentId, timestamp: iso(at), message }));
	}

	custom(customType: string, data: object | undefined, at: number): string {
		return this.push(({ id, parentId }) => ({ type: "custom", customType, data, id, parentId, timestamp: iso(at) }));
	}

	sessionInfo(name: string, at: number): string {
		return this.push(({ id, parentId }) => ({ type: "session_info", id, parentId, timestamp: iso(at), name }));
	}

	modelChange(provider: string, modelId: string, at: number): string {
		return this.push(({ id, parentId }) => ({
			type: "model_change",
			id,
			parentId,
			timestamp: iso(at),
			provider,
			modelId,
		}));
	}

	compaction(summary: string, firstKeptEntryId: string, at: number): string {
		return this.push(({ id, parentId }) => ({
			type: "compaction",
			id,
			parentId,
			timestamp: iso(at),
			summary,
			firstKeptEntryId,
			tokensBefore: 1000,
		}));
	}

	/** Moves the chain back to `entryId`, as Pi's `branch` does before the next append. */
	branchFrom(entryId: string | null): void {
		this.previous = entryId;
	}

	/** Appends an entry with exactly these ids, whatever the chain holds. */
	raw(entry: object): void {
		this.lines.push(entry);
	}

	text(options: { terminated?: boolean } = {}): string {
		const body = this.lines.map((line) => JSON.stringify(line)).join("\n");
		return options.terminated === false ? body : `${body}\n`;
	}
}

export function userEntryText(text: string): readonly object[] {
	return [{ type: "text", text }];
}

export function toolCall(id: string, name = "read", args: object = { path: "README.md" }): object {
	return { type: "toolCall", id, name, arguments: args };
}

export const textBlock = (text: string): object => ({ type: "text", text });
export const thinkingBlock = (thinking: string): object => ({ type: "thinking", thinking });
export const imageBlock = (data: string, mimeType = "image/png"): object => ({ type: "image", data, mimeType });

export function fileNameOf(builder: SessionBuilder): string {
	return `${iso(builder.options.createdAt ?? 0).replace(/[:.]/g, "-")}_${builder.options.id}.jsonl`;
}

/** Writes the builder's file into `dir` (created when missing) and returns its path. */
export function writeSession(dir: string, builder: SessionBuilder, options: { terminated?: boolean } = {}): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, fileNameOf(builder));
	writeFileSync(path, builder.text(options));
	return path;
}

/** `itemsOfEntry`, reduced to what the store tests look at. */
export function itemsOfEntryStub(entry: SessionEntry, context: EntryContext): TranscriptItem[] {
	if (entry.type === "model_change") {
		return [
			{
				kind: "model_change",
				id: entryItemId(entry.id, 0),
				modelId: modelWireId({ provider: entry.provider, id: entry.modelId }),
			},
		];
	}
	if (entry.type === "compaction") {
		return [
			{ kind: "compaction", id: entryItemId(entry.id, 0), summary: entry.summary, tokensBefore: entry.tokensBefore },
		];
	}
	if (entry.type !== "message") return [];
	const message = entry.message;
	if (message.role === "user") {
		const blocks =
			typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
		return [
			{
				kind: "user_message",
				id: entryItemId(entry.id, 0),
				text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
				attachments: blocks.flatMap((block, index) =>
					block.type === "image"
						? [{ kind: "image_ref" as const, id: entryAttachmentId(entry.id, index), mimeType: block.mimeType }]
						: [],
				),
				...(context.prompt && { clientRequestId: context.prompt.clientRequestId }),
			},
		];
	}
	if (message.role === "assistant") {
		return message.content.flatMap((block, index): TranscriptItem[] => {
			const id = entryItemId(entry.id, index);
			if (block.type === "toolCall") {
				return [
					{
						kind: "tool_call",
						id,
						toolCallId: storedToolCallId(entry.id, index),
						messageId: entry.id,
						name: block.name,
					},
				];
			}
			if (block.type === "unsupported") return [];
			const text = block.type === "text" ? block.text : block.thinking;
			return [{ kind: "block", id, messageId: entry.id, block: block.type === "text" ? "text" : "thinking", text }];
		});
	}
	if (message.role === "toolResult") {
		return [
			{
				kind: "tool_result",
				id: entryItemId(entry.id, 0),
				toolCallId: context.toolCallId ?? storedToolCallId(entry.id, 0),
				outcome: message.isError ? "failed" : "completed",
				result: { content: [], fileChanges: [] },
			},
		];
	}
	return [];
}
