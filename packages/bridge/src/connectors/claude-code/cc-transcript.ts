/**
 * Claude Code transcript builder.
 *
 * With `limit`, the transcript is built from a tail window instead of the whole file: message
 * order and content depend only on the lines that produce them (a tool_result only ever attaches
 * to a tool_use at an earlier line), so once the window has produced at least `limit` messages its
 * last `limit` messages are identical to the whole-file result. The window doubles until that
 * holds, and a window shorter than requested means the window already spans the whole file.
 *
 * Below `TRANSCRIPT_TAIL_MIN_BYTES` the whole file is streamed in one pass instead: re-reading a
 * few hundred kilobytes costs more than the pass it saves, and streaming keeps peak RSS flat.
 */

import { stat } from "node:fs/promises";
import type { ClaudeCodeTranscriptMessage } from "../../types";
import type { TranscriptPage } from "../../types/transcript-page";
import { readJsonlLines } from "../../utils/jsonl-lines";
import { readJsonlTail } from "../../utils/jsonl-tail";
import {
	type ClaudeTranscriptLine,
	extractFirstTextContent,
	isLikelyCommandEcho,
	isoToMs,
	safeParseJsonLine,
	type TranscriptContentBlock,
	toolResultToText,
	toolUseResultToDiff,
} from "./cc-transcript-parse";

export type TranscriptReadOptions = {
	/** Override the size below which the whole file is streamed instead of tailed. */
	tailMinBytes?: number;
};

export const TRANSCRIPT_TAIL_MIN_BYTES = 8 * 1024 * 1024;

const TAIL_WINDOW_GROWTH = 4;

function tailWindows(limit: number): number[] {
	const windows: number[] = [];
	let size = limit;
	for (let i = 0; i < TAIL_WINDOW_GROWTH; i++) {
		windows.push(size);
		size *= 2;
	}
	return windows;
}

async function* fromArray(lines: string[]): AsyncGenerator<string, void, undefined> {
	for (const line of lines) yield line;
}

type TranscriptToolCall = NonNullable<ClaudeCodeTranscriptMessage["toolCalls"]>[number];

type TranscriptState = {
	messages: ClaudeCodeTranscriptMessage[];
	toolIndexById: Map<string, { messageIndex: number; toolIndex: number }>;
	/** Absolute index of `messages[0]`. */
	base: number;
	/** Messages created so far, retained or not. */
	seen: number;
	/** Absolute index at which retention stops; messages at or past it are built but not kept. */
	keepTo: number | undefined;
	/** Longest retained window, rolling; 0 keeps everything below `keepTo`. */
	window: number;
};

function createState(options: { keepTo?: number; window?: number } = {}): TranscriptState {
	return {
		messages: [],
		toolIndexById: new Map(),
		base: 0,
		seen: 0,
		keepTo: options.keepTo,
		window: options.window ?? 0,
	};
}

/** Files a message under its absolute index, keeping only the window the caller asked for. */
function retain(state: TranscriptState, message: ClaudeCodeTranscriptMessage): number | null {
	const index = state.seen++;
	if (state.keepTo !== undefined && index >= state.keepTo) return null;
	state.messages.push(message);
	if (state.window > 0 && state.messages.length > state.window) {
		state.messages.shift();
		state.base++;
	}
	return index;
}

type ToolResultBlock = { toolUseId: string; output: string; toolUseResult: unknown };

function toolResultBlocks(parsed: ClaudeTranscriptLine): ToolResultBlock[] {
	const content = parsed.message?.content;
	if (!Array.isArray(content)) return [];
	const blocks: ToolResultBlock[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const trBlock = block as TranscriptContentBlock;
		if (trBlock.type !== "tool_result") continue;
		const toolUseId = trBlock.tool_use_id;
		if (!toolUseId) continue;
		blocks.push({
			toolUseId,
			output: toolResultToText(trBlock.content),
			toolUseResult: parsed.toolUseResult,
		});
	}
	return blocks;
}

function withToolResult(
	message: ClaudeCodeTranscriptMessage,
	tool: TranscriptToolCall,
	toolIndex: number,
	block: ToolResultBlock,
): ClaudeCodeTranscriptMessage {
	const toolCalls = [...(message.toolCalls ?? [])];
	toolCalls[toolIndex] = {
		...tool,
		status: "completed" as const,
		output: block.output || tool.output,
		metadata: {
			...(tool.metadata ?? {}),
			...(block.toolUseResult ? { toolUseResult: block.toolUseResult } : {}),
		},
	};

	const diff = toolUseResultToDiff(block.toolUseResult);
	const diffs = diff
		? [
				...(message.diffs ?? []),
				{
					file: diff.file,
					before: diff.before,
					after: diff.after,
					diff: diff.diff,
					additions: diff.additions,
					deletions: diff.deletions,
					partId: block.toolUseId,
				},
			]
		: (message.diffs ?? []);

	return { ...message, text: message.text ?? "", toolCalls, diffs };
}

function attachToolResults(state: TranscriptState, parsed: ClaudeTranscriptLine): void {
	for (const block of toolResultBlocks(parsed)) {
		const index = state.toolIndexById.get(block.toolUseId);
		if (!index) continue;
		const message = state.messages[index.messageIndex - state.base];
		if (!message) continue;
		const tool = message.toolCalls?.[index.toolIndex];
		if (!tool) continue;
		state.messages[index.messageIndex - state.base] = withToolResult(message, tool, index.toolIndex, block);
	}
}

function pushUserRecord(state: TranscriptState, parsed: ClaudeTranscriptLine, id: string, createdAt: number): void {
	const maybeText = extractFirstTextContent(parsed.message?.content);
	if (maybeText) {
		if (isLikelyCommandEcho(maybeText)) return;
		retain(state, { id, role: "user", createdAt, text: maybeText });
		return;
	}
	attachToolResults(state, parsed);
}

function assistantBlocks(content: unknown): { thinking: string; text: string; toolCalls: TranscriptToolCall[] } {
	if (typeof content === "string") return { thinking: "", text: content, toolCalls: [] };
	if (!Array.isArray(content)) return { thinking: "", text: "", toolCalls: [] };

	let thinking = "";
	let text = "";
	const toolCalls: TranscriptToolCall[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as TranscriptContentBlock;
		if (b.type === "thinking" && typeof b.thinking === "string") thinking += b.thinking;
		if (b.type === "text" && typeof b.text === "string") text += b.text;
		if (b.type === "tool_use" && b.id && b.name) {
			toolCalls.push({ toolUseId: b.id, tool: b.name, input: b.input, status: "running" });
		}
	}
	return { thinking, text, toolCalls };
}

function pushAssistantRecord(
	state: TranscriptState,
	parsed: ClaudeTranscriptLine,
	id: string,
	createdAt: number,
): void {
	const { thinking, text, toolCalls } = assistantBlocks(parsed.message?.content);
	const built = toolCalls.length > 0 ? toolCalls : undefined;

	const messageIndex = retain(state, {
		id,
		role: "assistant",
		createdAt,
		text,
		...(thinking.trim().length > 0 ? { thinking } : {}),
		...(built ? { toolCalls: built } : {}),
		diffs: [],
	});

	if (!built || messageIndex === null) return;
	for (let i = 0; i < built.length; i++) {
		const call = built[i];
		if (call) state.toolIndexById.set(call.toolUseId, { messageIndex, toolIndex: i });
	}
}

function appendRecord(state: TranscriptState, line: string): void {
	const parsed = safeParseJsonLine(line);
	if (!parsed) return;

	// Skip non-message records (snapshots, etc.)
	if (parsed.type !== "user" && parsed.type !== "assistant") return;
	if (parsed.isMeta === true) return;
	if (!parsed.message) return;

	const createdAt = isoToMs(parsed.timestamp);
	const id = parsed.uuid || `${parsed.type}-${createdAt}`;
	if (parsed.message.role === "user") pushUserRecord(state, parsed, id, createdAt);
	else if (parsed.message.role === "assistant") pushAssistantRecord(state, parsed, id, createdAt);
}

async function buildMessages(lines: AsyncGenerator<string, void, undefined>): Promise<ClaudeCodeTranscriptMessage[]> {
	const state = createState();
	for await (const line of lines) appendRecord(state, line);
	return state.messages;
}

/**
 * The page of transcript ending at the message index `end` (the whole transcript when omitted).
 *
 * The index counts from the start of the file, so a page keeps its meaning when the session grows
 * at the end. The file is streamed whole but only the page's window is retained: a tool result can
 * attach to a message well before it in the file, so dropping that message would change what the
 * page shows.
 */
export async function readCcTranscriptPage(
	filePath: string,
	options: { limit: number; end?: number },
): Promise<TranscriptPage<ClaudeCodeTranscriptMessage> | null> {
	const limit = Math.max(1, Math.floor(options.limit));
	const state = createState({ keepTo: options.end, window: limit });
	try {
		for await (const line of readJsonlLines(filePath)) appendRecord(state, line);
	} catch {
		return null;
	}

	const total = Math.min(options.end ?? state.seen, state.seen);
	const hasMore = total > limit;
	return {
		messages: state.messages,
		hasMore,
		...(hasMore ? { nextCursor: String(total - limit) } : {}),
	};
}

async function fileSize(filePath: string): Promise<number | null> {
	try {
		return (await stat(filePath)).size;
	} catch {
		return null;
	}
}

async function readLimited(
	filePath: string,
	limit: number,
	tailMinBytes: number,
): Promise<ClaudeCodeTranscriptMessage[]> {
	const size = await fileSize(filePath);
	if (size === null || size <= tailMinBytes) return buildMessages(readJsonlLines(filePath));

	for (const maxLines of tailWindows(limit)) {
		const lines = await readJsonlTail(filePath, { maxLines });
		if (lines.length < maxLines) return buildMessages(fromArray(lines));
		const messages = await buildMessages(fromArray(lines));
		if (messages.length >= limit) return messages;
	}
	return buildMessages(readJsonlLines(filePath));
}

export async function buildTranscriptMessages(
	filePath: string,
	limit?: number,
	options: TranscriptReadOptions = {},
): Promise<ClaudeCodeTranscriptMessage[]> {
	const tailMinBytes = options.tailMinBytes ?? TRANSCRIPT_TAIL_MIN_BYTES;
	try {
		const messages = await (limit && limit > 0
			? readLimited(filePath, limit, tailMinBytes)
			: buildMessages(readJsonlLines(filePath)));
		const filtered = messages.filter((m) => m.role !== "system");
		if (limit && limit > 0 && filtered.length > limit) {
			return filtered.slice(filtered.length - limit);
		}
		return filtered;
	} catch {
		return [];
	}
}
