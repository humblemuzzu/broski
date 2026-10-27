/**
 * Codex rollout transcript builder.
 *
 * Streams a rollout file and keeps only the last `limit` messages, so serving a transcript never
 * holds the whole file in memory. A rollout line only ever joins the message that is currently
 * open: a turn boundary — `task_started`, `turn_context`, or the user's next prompt — closes it, so
 * one long agent run arrives as many messages rather than one the size of the file.
 */

import type { CodexTranscriptMessage, CodexTranscriptToolCall } from "../../types";
import type { TranscriptPage } from "../../types/transcript-page";
import { readJsonlLines } from "../../utils/jsonl-lines";
import { fitTranscriptPage } from "../../utils/transcript-page-fit";
import { cutAtTurnStart, TURN_EXTENSION_MAX } from "../../utils/turn-aligned-page";
import {
	assistantTextFrom,
	type CustomToolCallEvent,
	classifyRecord,
	decodeToolInput,
	diffFromPatch,
	headTailTruncate,
	parseRecord,
	type RolloutEvent,
	recordIdentity,
	type ToolCallEvent,
	toolCallForFunction,
} from "./cx-transcript-records";

export const DEFAULT_CX_TRANSCRIPT_LIMIT = 200;

export type ReadCxTranscriptOptions = {
	limit?: number;
};

type ToolCall = CodexTranscriptToolCall;

const GC_INTERVAL_LINES = 2_000;
const TOOL_OUTPUT_HEAD_LINES = 50;
const TOOL_OUTPUT_TAIL_LINES = 30;

export class CxTranscriptBuilder {
	private readonly window: CodexTranscriptMessage[] = [];
	private readonly limit: number;
	private readonly keepTo: number | undefined;
	private readonly baseTime: number;
	private currentAssistant: CodexTranscriptMessage | null = null;
	private seq = 0;
	private created = 0;
	/** The record being read: what a message it creates is named after. */
	private at: number | undefined;
	private ordinal: number | undefined;

	constructor(limit: number = DEFAULT_CX_TRANSCRIPT_LIMIT, keepTo?: number) {
		this.limit = Math.max(1, Math.floor(limit));
		this.keepTo = keepTo;
		this.baseTime = Math.floor(Date.now() / 1000);
	}

	/** Messages seen so far, retained or not. */
	total(): number {
		return this.created;
	}

	pushLine(line: string): void {
		if (!line.trim()) return;
		const record = parseRecord(line);
		if (!record) return;
		const identity = recordIdentity(record);
		const event = classifyRecord(record);
		if (!event) return;
		this.at = identity.atSeconds;
		this.ordinal = identity.ordinal;
		this.pushEvent(event);
	}

	messages(): CodexTranscriptMessage[] {
		return this.window;
	}

	private pushEvent(event: RolloutEvent | null): void {
		if (!event) return;
		switch (event.kind) {
			case "turn-start":
				this.currentAssistant = null;
				return;
			case "user":
				this.pushUser(event.text);
				return;
			case "assistant-text":
				this.setAssistantText(event.content);
				return;
			case "reasoning":
				this.appendReasoning(event.text);
				return;
			case "tool-call":
				this.addFunctionCall(event);
				return;
			case "tool-output":
				this.completeToolCall(event.callId, event.output);
				return;
			case "custom-tool-call":
				this.addCustomToolCall(event);
				return;
			case "custom-tool-output":
				this.completeCustomToolCall(event.callId, event.output);
				return;
		}
	}

	private keep(message: CodexTranscriptMessage): void {
		const index = this.created++;
		if (this.keepTo !== undefined && index >= this.keepTo) return;
		this.window.push(message);
		if (this.window.length > this.limit) this.window.shift();
	}

	private pushUser(text: string): void {
		this.currentAssistant = null;
		this.keep({
			id: `user_${this.identityOf()}`,
			role: "user",
			createdAt: this.at ?? this.baseTime + this.seq,
			text,
		});
		this.seq++;
	}

	/**
	 * What the message this record creates is called: its own ordinal when the file has one, so the
	 * same line names the same message in a window and in a whole-file read.
	 */
	private identityOf(): string {
		return this.ordinal === undefined ? `${this.baseTime}_${this.seq}` : `${this.ordinal}`;
	}

	private getOrCreateAssistant(): CodexTranscriptMessage {
		if (this.currentAssistant) return this.currentAssistant;
		const message: CodexTranscriptMessage = {
			id: `assistant_${this.identityOf()}`,
			role: "assistant",
			createdAt: this.at ?? this.baseTime + this.seq,
			text: "",
			toolCalls: [],
			diffs: [],
		};
		this.keep(message);
		this.seq++;
		this.currentAssistant = message;
		return message;
	}

	private appendReasoning(text: string): void {
		if (!text) return;
		const assistant = this.getOrCreateAssistant();
		assistant.thinking = `${assistant.thinking ?? ""}\n${text}`.trim();
	}

	private setAssistantText(content: unknown): void {
		const text = assistantTextFrom(content);
		if (text) this.getOrCreateAssistant().text = text;
	}

	private addFunctionCall(event: ToolCallEvent): void {
		const assistant = this.getOrCreateAssistant();
		assistant.toolCalls = assistant.toolCalls ?? [];
		assistant.toolCalls.push(toolCallForFunction(event.name, event.callId, decodeToolInput(event.args)));
	}

	private addCustomToolCall(event: CustomToolCallEvent): void {
		if (event.name !== "apply_patch") return;
		const assistant = this.getOrCreateAssistant();
		assistant.toolCalls = assistant.toolCalls ?? [];
		assistant.diffs = assistant.diffs ?? [];
		assistant.toolCalls.push({
			itemId: event.callId,
			type: "fileChange",
			name: "ApplyPatch",
			status: event.status === "completed" ? "completed" : "running",
			input: { patch: event.input },
			output: event.input,
		});
		assistant.diffs.push(diffFromPatch(event.callId, event.input));
	}

	private completeToolCall(callId: string, output: string): void {
		const toolCall = this.findToolCall(callId);
		if (!toolCall) return;
		toolCall.status = "completed";
		toolCall.output = headTailTruncate(output, TOOL_OUTPUT_HEAD_LINES, TOOL_OUTPUT_TAIL_LINES);
	}

	private completeCustomToolCall(callId: string, output: string): void {
		const toolCall = this.findToolCall(callId);
		if (!toolCall) return;
		toolCall.status = "completed";
		if (output) toolCall.output = headTailTruncate(output, TOOL_OUTPUT_HEAD_LINES, TOOL_OUTPUT_TAIL_LINES);
	}

	private findToolCall(callId: string): ToolCall | undefined {
		if (!callId) return undefined;
		for (let index = this.window.length - 1; index >= 0; index--) {
			const found = this.window[index]?.toolCalls?.find((candidate) => candidate.itemId === callId);
			if (found) return found;
		}
		return undefined;
	}
}

/** Map a rollout file into the transcript shape, keeping only the last `limit` messages. */
export async function readCxTranscript(
	filePath: string,
	options: ReadCxTranscriptOptions = {},
): Promise<CodexTranscriptMessage[]> {
	const builder = new CxTranscriptBuilder(options.limit ?? DEFAULT_CX_TRANSCRIPT_LIMIT);
	await streamRollout(filePath, builder);
	return builder.messages();
}

/**
 * The page of transcript ending at message index `end` (the tail of the file when omitted).
 *
 * The index counts from the start of the file, so a page keeps its meaning when the rollout grows
 * at the end. The file is streamed whole but only the page's window is retained.
 */
export async function readCxTranscriptPage(
	filePath: string,
	options: { limit: number; end?: number },
): Promise<TranscriptPage<CodexTranscriptMessage> | null> {
	const limit = Math.max(1, Math.floor(options.limit));
	const builder = new CxTranscriptBuilder(limit + TURN_EXTENSION_MAX, options.end);
	if (!(await streamRollout(filePath, builder))) return null;

	const total = Math.min(options.end ?? builder.total(), builder.total());
	return turnAlignedCxPage(builder.messages(), total, limit);
}

/** Same window over an already-built transcript, e.g. the one the app-server hands back. */
export function sliceCxTranscriptPage(
	messages: CodexTranscriptMessage[],
	options: { limit: number; end?: number },
): TranscriptPage<CodexTranscriptMessage> {
	const limit = Math.max(1, Math.floor(options.limit));
	const total = Math.min(options.end ?? messages.length, messages.length);
	return turnAlignedCxPage(messages, total, limit);
}

function turnAlignedCxPage(
	messages: CodexTranscriptMessage[],
	total: number,
	limit: number,
): TranscriptPage<CodexTranscriptMessage> {
	const base = Math.max(0, total - messages.length);
	const cut = cutAtTurnStart(messages, Math.max(0, total - limit - base), {
		isUser: (message) => message.role === "user",
	});
	const fitted = fitTranscriptPage(messages.slice(cut.start));
	const start = base + cut.start + fitted.dropped;
	const hasMore = start > 0;
	return {
		messages: fitted.messages,
		hasMore,
		...(hasMore ? { nextCursor: String(start) } : {}),
	};
}

async function streamRollout(filePath: string, builder: CxTranscriptBuilder): Promise<boolean> {
	try {
		let lines = 0;
		for await (const line of readJsonlLines(filePath)) {
			builder.pushLine(line);
			lines++;
			// Rollout records are transient garbage; without an occasional forced collection the heap
			// grows to several times the size of the transcript actually returned.
			if (lines % GC_INTERVAL_LINES === 0) Bun.gc(true);
		}
	} catch {
		return false;
	}
	return true;
}
