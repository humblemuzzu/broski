/**
 * Extracts subagent tool invocations from Pi session JSONL files.
 *
 * Pi subagents (Task, oracle, finder, code_review, look_at, librarian) run via
 * piSpawn() with --no-session, so their entire conversation is embedded as a
 * tool call + tool result inside the parent session's JSONL. This module scans
 * for those entries and returns them as browseable pseudo-child-sessions.
 */

import { readFile } from "node:fs/promises";
import type { BroskiSessionSummary } from "../../types/runtime";

const SUBAGENT_TOOL_NAMES = new Set([
	"task",
	"Task",
	"oracle",
	"finder",
	"code_review",
	"look_at",
	"librarian",
]);

export type PiSubagentInvocation = {
	toolCallId: string;
	toolName: string;
	prompt: string;
	result?: string;
	startedAtMs: number;
	finishedAtMs?: number;
};

/**
 * Scan a Pi session JSONL file for subagent tool invocations.
 * Returns a list of tool calls that are subagent spawns.
 */
export async function extractSubagentInvocations(
	sessionPath: string,
): Promise<PiSubagentInvocation[]> {
	let raw: string;
	try {
		raw = await readFile(sessionPath, "utf-8");
	} catch {
		return [];
	}

	const invocations: PiSubagentInvocation[] = [];
	const toolCalls = new Map<string, { name: string; prompt: string; timestamp: number }>();

	const lines = raw.split("\n");
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

		// Assistant messages contain toolCall entries
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block?.type !== "toolCall") continue;
				if (!SUBAGENT_TOOL_NAMES.has(block.name)) continue;
				// Extract the prompt from arguments
				const args = block.arguments ?? {};
				const prompt =
					typeof args.description === "string"
						? args.description
						: typeof args.subject === "string"
							? args.subject
							: typeof args.query === "string"
								? args.query
								: typeof args.prompt === "string"
									? args.prompt
									: typeof args.pattern === "string"
										? args.pattern
										: JSON.stringify(args).slice(0, 120);
				toolCalls.set(block.id, {
					name: block.name,
					prompt,
					timestamp: Number(message.timestamp ?? parsed.timestamp ?? Date.now()),
				});
			}
		}

		// Tool results close out the invocation
		if (message.role === "toolResult" && message.toolCallId) {
			const call = toolCalls.get(message.toolCallId);
			if (call && SUBAGENT_TOOL_NAMES.has(message.toolName ?? call.name)) {
				// Extract a short result summary
				let result: string | undefined;
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block?.type === "text" && typeof block.text === "string") {
							result = block.text.slice(0, 300);
							break;
						}
					}
				} else if (typeof message.content === "string") {
					result = message.content.slice(0, 300);
				}

				invocations.push({
					toolCallId: message.toolCallId,
					toolName: call.name,
					prompt: call.prompt,
					result,
					startedAtMs: call.timestamp,
					finishedAtMs: Number(message.timestamp ?? parsed.timestamp ?? Date.now()),
				});
				toolCalls.delete(message.toolCallId);
			}
		}
	}

	// Any remaining unfinished tool calls (still running or interrupted)
	for (const [id, call] of toolCalls) {
		invocations.push({
			toolCallId: id,
			toolName: call.name,
			prompt: call.prompt,
			startedAtMs: call.timestamp,
		});
	}

	return invocations;
}

/**
 * Map Pi subagent invocations to BroskiSessionSummary format
 * so they can be displayed as child sessions.
 */
export function mapInvocationsToSummaries(
	invocations: PiSubagentInvocation[],
	parentSessionId: string,
	cwd: string,
): BroskiSessionSummary[] {
	return invocations.map((inv) => ({
		id: `${parentSessionId}::${inv.toolCallId}`,
		backend: "pi" as const,
		title: inv.prompt.slice(0, 80) || `${inv.toolName} invocation`,
		cwd,
		createdAtMs: inv.startedAtMs,
		updatedAtMs: inv.finishedAtMs ?? inv.startedAtMs,
		parentSessionId,
		sessionKind: "subagent" as const,
		subagentType: inv.toolName,
		backendData: {
			toolCallId: inv.toolCallId,
			toolName: inv.toolName,
			prompt: inv.prompt,
			resultPreview: inv.result,
		},
	}));
}
