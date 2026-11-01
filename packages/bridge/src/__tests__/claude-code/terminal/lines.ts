/** Transcript lines in the shape the real CLI writes them (read from a recorded run, 2.1.316), for the translator's tests. */

import { randomUUID } from "node:crypto";

export type Line = Record<string, unknown>;

const COMMON = {
	isSidechain: false,
	userType: "external",
	entrypoint: "cli",
	version: "2.1.316",
};

export function prompt(text: string, uuid: string = randomUUID(), extra: Line = {}): Line {
	return {
		...COMMON,
		parentUuid: null,
		type: "user",
		message: { role: "user", content: text },
		uuid,
		timestamp: new Date().toISOString(),
		...extra,
	};
}

export function assistant(
	messageId: string,
	block: Line,
	options: { index?: number; stop?: string | null; uuid?: string } = {},
): Line {
	return {
		...COMMON,
		parentUuid: null,
		type: "assistant",
		message: {
			id: messageId,
			type: "message",
			role: "assistant",
			model: "claude-opus-5-5",
			content: [block],
			stop_reason: options.stop === undefined ? "end_turn" : options.stop,
		},
		...(options.index !== undefined && { apiBlockIndex: options.index }),
		uuid: options.uuid ?? randomUUID(),
		timestamp: new Date().toISOString(),
	};
}

export const text = (value: string): Line => ({ type: "text", text: value });
export const thinking = (value: string): Line => ({
	type: "thinking",
	thinking: value,
	signature: "sig",
});
export const toolUse = (id: string, name: string, input: unknown): Line => ({
	type: "tool_use",
	id,
	name,
	input,
});

export function toolResult(
	toolUseId: string,
	content: string,
	toolUseResult?: unknown,
	uuid: string = randomUUID(),
): Line {
	return {
		...COMMON,
		parentUuid: null,
		type: "user",
		message: {
			role: "user",
			content: [{ tool_use_id: toolUseId, type: "tool_result", content }],
		},
		uuid,
		timestamp: new Date().toISOString(),
		...(toolUseResult !== undefined && { toolUseResult }),
	};
}

export function system(subtype: string, extra: Line = {}): Line {
	return {
		...COMMON,
		type: "system",
		subtype,
		uuid: randomUUID(),
		timestamp: new Date().toISOString(),
		...extra,
	};
}

export const turnDuration = (): Line => system("turn_duration", { durationMs: 1200, messageCount: 4, isMeta: false });

/** Lines the CLI writes that mean nothing to a live view. */
export function noise(): Line[] {
	const base = { sessionId: "s", timestamp: new Date().toISOString() };
	return [
		{ type: "queue-operation", operation: "enqueue", content: "hi", ...base },
		{
			type: "attachment",
			attachment: { type: "environment" },
			uuid: randomUUID(),
			...COMMON,
			...base,
		},
		{
			type: "attachment",
			attachment: { type: "queued_command" },
			uuid: randomUUID(),
			...COMMON,
			...base,
		},
		{ type: "ai-title", aiTitle: "t", ...base },
		{ type: "last-prompt", lastPrompt: "p", leafUuid: randomUUID(), ...base },
		{ type: "permission-mode", permissionMode: "default", ...base },
		{ type: "mode", mode: "x", ...base },
		{
			type: "file-history-snapshot",
			messageId: "m",
			snapshot: {},
			isSnapshotUpdate: false,
		},
		{ type: "cost-state", totalCostUSD: 1, ...base },
		{ type: "api-request", id: "r", params: {}, ...base },
		{ type: "atis-latch", atis: "", ...base },
		{
			type: "system",
			subtype: "away_summary",
			content: "away",
			uuid: randomUUID(),
			...base,
		},
		{
			type: "system",
			subtype: "informational",
			content: "info",
			uuid: randomUUID(),
			...base,
		},
	];
}
