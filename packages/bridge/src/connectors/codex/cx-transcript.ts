/**
 * Codex rollout transcript builder.
 *
 * Streams a rollout file and keeps only the last `limit` messages, so serving a transcript never
 * holds the whole file in memory. A rollout line only ever joins the message that is currently
 * open — the builder starts a new message on `event_msg/user_message` and closes it at the next
 * one — so the messages are read in file order and the window is taken at the end.
 */

import type { CodexTranscriptDiff, CodexTranscriptMessage, CodexTranscriptToolCall } from "../../types";
import type { TranscriptPage } from "../../types/transcript-page";
import { readJsonlLines } from "../../utils/jsonl-lines";
import { extractUserPrompt } from "./cx-rollout-meta";

export const DEFAULT_CX_TRANSCRIPT_LIMIT = 200;

export type ReadCxTranscriptOptions = {
	limit?: number;
};

type ToolCall = CodexTranscriptToolCall;
type Diff = CodexTranscriptDiff;
type TranscriptRecord = Record<string, unknown>;

function isRecord(value: unknown): value is TranscriptRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): TranscriptRecord {
	return isRecord(value) ? value : {};
}

function safeStr(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseRecord(line: string): TranscriptRecord | null {
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Count `+` / `-` diff lines the same way the file-scanner does. */
function countDiffAddsDels(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds++;
		else if (line.startsWith("-")) dels++;
	}
	return { adds, dels };
}

/**
 * Head/tail truncation of a tool output. Kept in the `split`/`join` form the file scanner uses: the
 * result is one flat string, whereas `slice` results keep the record they came from alive as a parent.
 */
function headTailTruncate(text: string, headLines: number, tailLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= headLines + tailLines + 5) return text;
	const head = lines.slice(0, headLines).join("\n");
	const tail = lines.slice(-tailLines).join("\n");
	const omitted = lines.length - headLines - tailLines;
	return `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`;
}

function toolCallForFunction(name: string, callId: string, args: Record<string, unknown>): ToolCall {
	if (name === "shell_command" || name === "shell") {
		return { itemId: callId, type: "commandExecution", name: "Bash", status: "running", input: args };
	}
	if (name === "apply_patch") {
		return { itemId: callId, type: "fileChange", name: "ApplyPatch", status: "running", input: args };
	}
	return { itemId: callId, type: "mcpToolCall", name, status: "running", input: args };
}

export class CxTranscriptBuilder {
	private readonly window: CodexTranscriptMessage[] = [];
	private readonly limit: number;
	private readonly keepTo: number | undefined;
	private readonly baseTime: number;
	private currentAssistant: CodexTranscriptMessage | null = null;
	private seq = 0;
	private created = 0;

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
		const payload = asRecord(record.payload);
		const type = safeStr(record.type);

		if (type === "session_meta" || type === "turn_context") return;
		if (type === "event_msg" && payload.type === "token_count") return;
		if (type === "event_msg" && payload.type === "user_message") {
			this.pushUser(extractUserPrompt(safeStr(payload.message)));
			return;
		}
		if (type === "event_msg" && payload.type === "agent_reasoning") {
			const thinking = safeStr(payload.text);
			if (thinking) this.startNewAssistant(thinking);
			return;
		}
		if (type !== "response_item") return;

		if (payload.type === "message" && payload.role === "user") return;
		if (payload.type === "reasoning") this.appendReasoningSummary(payload);
		else if (payload.type === "message" && payload.role === "assistant") this.setAssistantText(payload);
		else if (payload.type === "function_call") this.addFunctionCall(payload);
		else if (payload.type === "function_call_output") this.completeToolCall(payload);
		else if (payload.type === "custom_tool_call") this.addCustomToolCall(payload);
	}

	messages(): CodexTranscriptMessage[] {
		return this.window;
	}

	private keep(message: CodexTranscriptMessage): void {
		const index = this.created++;
		if (this.keepTo !== undefined && index >= this.keepTo) return;
		this.window.push(message);
		if (this.window.length > this.limit) this.window.shift();
	}

	private pushUser(text: string): void {
		if (!text) return;
		this.keep({ id: `user_${this.baseTime}_${this.seq}`, role: "user", createdAt: this.baseTime + this.seq, text });
		this.seq++;
		this.currentAssistant = null;
	}

	private startNewAssistant(thinking?: string): CodexTranscriptMessage {
		const current = this.currentAssistant;
		if (current && !current.text && !current.thinking && !(current.toolCalls ?? []).length) {
			if (thinking) current.thinking = thinking;
			return current;
		}
		const message: CodexTranscriptMessage = {
			id: `assistant_${this.baseTime}_${this.seq}`,
			role: "assistant",
			createdAt: this.baseTime + this.seq,
			text: "",
			thinking: thinking || undefined,
			toolCalls: [],
			diffs: [],
		};
		this.keep(message);
		this.seq++;
		this.currentAssistant = message;
		return message;
	}

	private getOrCreateAssistant(): CodexTranscriptMessage {
		return this.currentAssistant ?? this.startNewAssistant();
	}

	private appendReasoningSummary(payload: TranscriptRecord): void {
		const summary = Array.isArray(payload.summary)
			? payload.summary.map((entry) => safeStr(asRecord(entry).text)).join("\n")
			: "";
		if (!summary) return;
		const assistant = this.getOrCreateAssistant();
		assistant.thinking = `${assistant.thinking ?? ""}\n${summary}`.trim();
	}

	private setAssistantText(payload: TranscriptRecord): void {
		const content = Array.isArray(payload.content) ? payload.content : [];
		const parts: string[] = [];
		for (const block of content) {
			const entry = asRecord(block);
			if (safeStr(entry.type) === "output_text") parts.push(safeStr(entry.text));
		}
		const text = parts.filter(Boolean).join("\n\n").trim();
		if (text) this.getOrCreateAssistant().text = text;
	}

	private addFunctionCall(payload: TranscriptRecord): void {
		const assistant = this.getOrCreateAssistant();
		assistant.toolCalls = assistant.toolCalls ?? [];
		let args: Record<string, unknown> = {};
		try {
			const parsed: unknown = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments;
			if (isRecord(parsed)) args = parsed;
		} catch {
			/* arguments are not JSON — keep them out of the input */
		}
		assistant.toolCalls.push(toolCallForFunction(safeStr(payload.name), safeStr(payload.call_id), args));
	}

	private completeToolCall(payload: TranscriptRecord): void {
		const callId = safeStr(payload.call_id);
		const output = safeStr(payload.output);
		for (const toolCall of this.currentAssistant?.toolCalls ?? []) {
			if (toolCall.itemId !== callId) continue;
			toolCall.status = "completed";
			toolCall.output = headTailTruncate(output, 50, 30);
			return;
		}
	}

	private addCustomToolCall(payload: TranscriptRecord): void {
		const input = safeStr(payload.input);
		const name = safeStr(payload.name);
		const callId = safeStr(payload.call_id);
		const assistant = this.getOrCreateAssistant();
		assistant.toolCalls = assistant.toolCalls ?? [];
		assistant.diffs = assistant.diffs ?? [];
		if (name !== "apply_patch") return;

		assistant.toolCalls.push({
			itemId: callId,
			type: "fileChange",
			name: "ApplyPatch",
			status: safeStr(payload.status) === "completed" ? "completed" : "running",
			input: { patch: input },
			output: input,
		});

		const { adds, dels } = countDiffAddsDels(input);
		const diff: Diff = {
			file: input.match(/\*\*\* Update File: ([^\n]+)/)?.[1] ?? "unknown",
			diff: input,
			additions: adds,
			deletions: dels,
			itemId: callId,
		};
		assistant.diffs.push(diff);
	}
}

const GC_INTERVAL_LINES = 2_000;

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
	const builder = new CxTranscriptBuilder(limit, options.end);
	if (!(await streamRollout(filePath, builder))) return null;

	const total = Math.min(options.end ?? builder.total(), builder.total());
	const hasMore = total > limit;
	return {
		messages: builder.messages(),
		hasMore,
		...(hasMore ? { nextCursor: String(total - limit) } : {}),
	};
}

/** Same window over an already-built transcript, e.g. the one the app-server hands back. */
export function sliceCxTranscriptPage(
	messages: CodexTranscriptMessage[],
	options: { limit: number; end?: number },
): TranscriptPage<CodexTranscriptMessage> {
	const limit = Math.max(1, Math.floor(options.limit));
	const total = Math.min(options.end ?? messages.length, messages.length);
	const hasMore = total > limit;
	return {
		messages: messages.slice(Math.max(0, total - limit), total),
		hasMore,
		...(hasMore ? { nextCursor: String(total - limit) } : {}),
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
