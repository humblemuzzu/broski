/**
 * Codex rollout record classification.
 *
 * A rollout is a JSONL stream of `session_meta`, `turn_context`, `event_msg` notifications and
 * `response_item` model output. The oldest rollouts write the same payloads without the
 * `response_item` wrapper, so a record's own `type` is read as the payload type too.
 *
 * One record becomes at most one `RolloutEvent`: a turn boundary, the user's prompt, assistant
 * text, a reasoning summary, or a tool call / tool output paired by `call_id`.
 */

import type { CodexTranscriptDiff, CodexTranscriptToolCall } from "../../types";
import { isInjectedUserContent } from "./cx-injected-user-content";
import { extractUserPrompt } from "./cx-rollout-meta";

export type TranscriptRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is TranscriptRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): TranscriptRecord {
	return isRecord(value) ? value : {};
}

export function safeStr(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function parseRecord(line: string): TranscriptRecord | null {
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export type RolloutEvent =
	| { kind: "turn-start" }
	| { kind: "user"; text: string }
	| { kind: "assistant-text"; content: unknown }
	| { kind: "reasoning"; text: string }
	| { kind: "tool-call"; callId: string; name: string; args: unknown }
	| { kind: "tool-output"; callId: string; output: string }
	| { kind: "custom-tool-call"; callId: string; name: string; status: string; input: string }
	| { kind: "custom-tool-output"; callId: string; output: string };

export type ToolCallEvent = Extract<RolloutEvent, { kind: "tool-call" }>;
export type CustomToolCallEvent = Extract<RolloutEvent, { kind: "custom-tool-call" }>;

export function classifyRecord(record: TranscriptRecord): RolloutEvent | null {
	const type = safeStr(record.type);
	if (type === "session_meta") return null;
	if (type === "turn_context") return { kind: "turn-start" };
	if (type === "event_msg") return classifyEventMsg(asRecord(record.payload));
	if (type === "response_item") return classifyPayload(asRecord(record.payload));
	return classifyPayload(record);
}

/**
 * `task_started` opens a turn, exactly once per user submission. `turn_context` re-states the turn
 * for every model round inside it (a long exchange carries many), so it is a boundary too.
 */
function classifyEventMsg(payload: TranscriptRecord): RolloutEvent | null {
	switch (safeStr(payload.type)) {
		case "task_started":
			return { kind: "turn-start" };
		case "user_message": {
			const raw = safeStr(payload.message);
			if (isInjectedUserContent(raw)) return null;
			const text = extractUserPrompt(raw);
			return text ? { kind: "user", text } : null;
		}
		case "agent_reasoning": {
			const text = safeStr(payload.text);
			return text ? { kind: "reasoning", text } : null;
		}
		default:
			return null;
	}
}

function classifyPayload(payload: TranscriptRecord): RolloutEvent | null {
	switch (safeStr(payload.type)) {
		case "message":
			return classifyMessage(payload);
		case "reasoning": {
			const text = reasoningTextFrom(payload.summary);
			return text ? { kind: "reasoning", text } : null;
		}
		case "function_call":
			return {
				kind: "tool-call",
				callId: safeStr(payload.call_id),
				name: safeStr(payload.name),
				args: payload.arguments,
			};
		case "function_call_output":
			return { kind: "tool-output", callId: safeStr(payload.call_id), output: safeStr(payload.output) };
		case "custom_tool_call":
			return {
				kind: "custom-tool-call",
				callId: safeStr(payload.call_id),
				name: safeStr(payload.name),
				status: safeStr(payload.status),
				input: safeStr(payload.input),
			};
		case "custom_tool_call_output":
			return { kind: "custom-tool-output", callId: safeStr(payload.call_id), output: safeStr(payload.output) };
		default:
			return null;
	}
}

function classifyMessage(payload: TranscriptRecord): RolloutEvent | null {
	const role = safeStr(payload.role);
	if (role === "user") {
		const text = userPromptFromContent(payload.content);
		return text ? { kind: "user", text } : null;
	}
	if (role === "assistant") return { kind: "assistant-text", content: payload.content };
	return null;
}

/** The first `input_text` block that is the user's own words, or "" when the message is all context. */
export function userPromptFromContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		const entry = asRecord(block);
		if (safeStr(entry.type) !== "input_text") continue;
		const text = safeStr(entry.text);
		if (!text) continue;
		if (isInjectedUserContent(text)) continue;
		const prompt = extractUserPrompt(text);
		if (prompt) return prompt;
	}
	return "";
}

export function assistantTextFrom(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const entry = asRecord(block);
		if (safeStr(entry.type) !== "output_text") continue;
		const text = safeStr(entry.text);
		if (text) parts.push(text);
	}
	return parts.join("\n\n").trim();
}

export function reasoningTextFrom(summary: unknown): string {
	if (!Array.isArray(summary)) return "";
	return summary
		.map((entry) => safeStr(asRecord(entry).text))
		.filter(Boolean)
		.join("\n");
}

export function decodeToolInput(args: unknown): Record<string, unknown> {
	if (typeof args === "string") {
		try {
			const parsed: unknown = JSON.parse(args);
			return isRecord(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return isRecord(args) ? args : {};
}

export function toolCallForFunction(
	name: string,
	callId: string,
	args: Record<string, unknown>,
): CodexTranscriptToolCall {
	if (name === "shell_command" || name === "shell") {
		return { itemId: callId, type: "commandExecution", name: "Bash", status: "running", input: args };
	}
	if (name === "apply_patch") {
		return { itemId: callId, type: "fileChange", name: "ApplyPatch", status: "running", input: args };
	}
	return { itemId: callId, type: "mcpToolCall", name, status: "running", input: args };
}

/**
 * Head/tail truncation of a tool output. Kept in the `split`/`join` form the file scanner uses: the
 * result is one flat string, whereas `slice` results keep the record they came from alive as a parent.
 */
export function headTailTruncate(text: string, headLines: number, tailLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= headLines + tailLines + 5) return text;
	const head = lines.slice(0, headLines).join("\n");
	const tail = lines.slice(-tailLines).join("\n");
	const omitted = lines.length - headLines - tailLines;
	return `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`;
}

/** Count `+` / `-` diff lines the same way the file-scanner does. */
export function countDiffAddsDels(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds++;
		else if (line.startsWith("-")) dels++;
	}
	return { adds, dels };
}

export function diffFromPatch(itemId: string, patch: string): CodexTranscriptDiff {
	const { adds, dels } = countDiffAddsDels(patch);
	return {
		file: patch.match(/\*\*\* Update File: ([^\n]+)/)?.[1] ?? "unknown",
		diff: patch,
		additions: adds,
		deletions: dels,
		itemId,
	};
}
