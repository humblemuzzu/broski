/**
 * Pi subagent invocation handler.
 *
 * Pi subagents (Task, oracle, finder, code_review, look_at, librarian, plus
 * any user-configured extension tool that spawns a child agent) do NOT have
 * their own session files. The entire subagent conversation lives as a
 * toolCall + toolResult pair inside the PARENT session's JSONL.
 *
 * This handler re-reads the parent JSONL and returns the full, untruncated
 * tool call arguments and tool result content blocks for a single invocation
 * identified by (parentSessionPath, toolCallId).
 *
 * Response shape is structured (not flattened) so the Flutter side can render
 * prompt + all content blocks with proper markdown/code formatting.
 */

import { readFile, stat } from "node:fs/promises";
import type { ServerMessage } from "../types";
import type { PiSubagentInvocationPayload } from "../types/pi";

type Reply = (msg: ServerMessage) => void;

/** Hard cap on parent JSONL size to prevent OOM on pathological sessions. */
const MAX_SESSION_JSONL_BYTES = 20 * 1024 * 1024;

export async function handle(message: Record<string, unknown>, reply: Reply): Promise<boolean> {
	if (message.type !== "pi_get_subagent_invocation") return false;

	const parentSessionPath = String(message.parentSessionPath ?? "");
	const toolCallId = String(message.toolCallId ?? "");
	const requestId = message.requestId as string | undefined;

	if (!parentSessionPath || !toolCallId) {
		reply({
			type: "pi_subagent_invocation",
			data: null,
			requestId,
		});
		return true;
	}

	try {
		const payload = await extractInvocation(parentSessionPath, toolCallId);
		reply({
			type: "pi_subagent_invocation",
			data: payload,
			requestId,
		});
	} catch (error) {
		console.error("[pi_get_subagent_invocation] error:", error);
		reply({
			type: "pi_subagent_invocation",
			data: null,
			requestId,
		});
	}
	return true;
}

async function extractInvocation(sessionPath: string, toolCallId: string): Promise<PiSubagentInvocationPayload | null> {
	const info = await stat(sessionPath);
	if (info.size > MAX_SESSION_JSONL_BYTES) {
		console.warn(`[pi_get_subagent_invocation] ${sessionPath} exceeds ${MAX_SESSION_JSONL_BYTES} byte cap`);
		return null;
	}
	const raw = await readFile(sessionPath, "utf-8");
	const lines = raw.split("\n");

	let toolCall: {
		id: string;
		name: string;
		arguments: Record<string, unknown>;
		startedAtMs: number;
	} | null = null;

	let toolResult: {
		content: unknown;
		isError: boolean;
		finishedAtMs: number;
		toolName?: string;
	} | null = null;

	let parentMessageId: string | undefined;
	let nextMessageThinking: string | null = null;
	let nextMessageText: string | null = null;

	for (const line of lines) {
		if (!line.trim()) continue;
		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (parsed?.type !== "message") continue;

		const message = parsed.message;
		if (!message) continue;

		// Assistant message containing the toolCall block
		if (message.role === "assistant" && Array.isArray(message.content)) {
			// Capture any leading thinking/text in the same assistant message
			// so we can show the parent agent's reasoning before dispatching the
			// subagent. This is optional context for the detail view.
			let thinking: string | null = null;
			let text: string | null = null;
			let matchedCall: any = null;

			for (const block of message.content) {
				if (!block || typeof block !== "object") continue;
				if (block.type === "thinking" && typeof block.thinking === "string") {
					thinking = (thinking ?? "") + block.thinking;
				} else if (block.type === "text" && typeof block.text === "string") {
					text = (text ?? "") + block.text;
				} else if (block.type === "toolCall" && block.id === toolCallId) {
					matchedCall = block;
				}
			}

			if (matchedCall) {
				parentMessageId = parsed.id;
				nextMessageThinking = thinking;
				nextMessageText = text;
				const tsRaw = message.timestamp ?? parsed.timestamp ?? Date.now();
				toolCall = {
					id: String(matchedCall.id),
					name: String(matchedCall.name ?? "tool"),
					arguments:
						matchedCall.arguments && typeof matchedCall.arguments === "object"
							? (matchedCall.arguments as Record<string, unknown>)
							: {},
					startedAtMs: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || Date.now(),
				};
			}
		}

		// Tool result for the matching call (role: "toolResult")
		if (message.role === "toolResult" && typeof message.toolCallId === "string" && message.toolCallId === toolCallId) {
			const tsRaw = message.timestamp ?? parsed.timestamp ?? Date.now();
			toolResult = {
				content: message.content,
				isError: Boolean(message.isError),
				finishedAtMs: typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) || Date.now(),
				toolName: typeof message.toolName === "string" ? message.toolName : undefined,
			};
			// Once we have both, we can stop scanning — but keep going in case
			// of multiple toolCallId collisions (defensive: last wins).
		}
	}

	if (!toolCall) return null;

	return {
		toolCallId: toolCall.id,
		toolName: toolResult?.toolName ?? toolCall.name,
		fullArguments: toolCall.arguments,
		contentBlocks: normalizeContentBlocks(toolResult?.content),
		isError: toolResult?.isError ?? false,
		startedAtMs: toolCall.startedAtMs,
		finishedAtMs: toolResult?.finishedAtMs,
		durationMs:
			toolResult?.finishedAtMs && toolCall.startedAtMs ? toolResult.finishedAtMs - toolCall.startedAtMs : undefined,
		parentMessageId,
		parentAssistantThinking: nextMessageThinking ?? undefined,
		parentAssistantText: nextMessageText ?? undefined,
	};
}

/**
 * Normalize tool result content into a structured list of blocks.
 * Pi tool results can be:
 *  - a string (plain text)
 *  - an array of { type: "text", text } | { type: "image", ... } | other
 *  - an object with content nested inside
 */
function normalizeContentBlocks(content: unknown): Array<{ type: string; text?: string; data?: unknown }> {
	if (content === null || content === undefined) return [];
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	if (Array.isArray(content)) {
		const out: Array<{ type: string; text?: string; data?: unknown }> = [];
		for (const block of content) {
			if (!block || typeof block !== "object") {
				if (typeof block === "string") out.push({ type: "text", text: block });
				continue;
			}
			const b = block as any;
			const type = typeof b.type === "string" ? b.type : "unknown";
			if (type === "text" && typeof b.text === "string") {
				out.push({ type: "text", text: b.text });
			} else {
				// Preserve unknown block types as structured data so the UI can
				// render them as JSON fallback.
				out.push({ type, data: b });
			}
		}
		return out;
	}
	// Object — wrap as single data block
	return [{ type: "object", data: content }];
}
