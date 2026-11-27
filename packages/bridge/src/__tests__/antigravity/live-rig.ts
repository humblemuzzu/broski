/**
 * A live session's turns and asks fed through the bridge's own JSON-RPC layer, and the records ACP's documentation shows
 * (agentclientprotocol.com/protocol/v1/draft: prompt-turn, tool-calls, cancellation; the v1 schema's
 * `CancelRequestNotification`), as written there. None is a record agy wrote: what agy does with them is checked on the
 * real `agy`. Every stream is held to the contract's stream rules (`contract/testing/stream-rules.ts`).
 */

import { LiveState } from "../../adapter-kit/live-state";
import type { PromptResult as PromptAnswer } from "../../backends/antigravity/acp/frames";
import { JsonRpc, type RpcResult } from "../../backends/antigravity/acp/rpc";
import { AgyAsks } from "../../backends/antigravity/live/asks";
import { PhonePrompts } from "../../backends/antigravity/live/phone-prompts";
import { Turns } from "../../backends/antigravity/live/turns";
import { ANTIGRAVITY_TRAITS } from "../../backends/antigravity/traits";
import { emptySnapshot, type Interaction, type SinkRecord } from "../../contract";
import { streamViolations } from "../../contract/testing/stream-rules";

export const SESSION = "sess_abc123def456";

/** protocol/v1/draft/tool-calls, "Requesting permission" */
export const PERMISSION = {
	jsonrpc: "2.0",
	id: 5,
	method: "session/request_permission",
	params: {
		sessionId: SESSION,
		toolCall: { toolCallId: "call_001" },
		options: [
			{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
			{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
		],
	},
};

export function update(body: object) {
	return { jsonrpc: "2.0", method: "session/update", params: { sessionId: SESSION, update: body } };
}

/** protocol/v1/draft/prompt-turn, "3. Agent reports output" */
export const CHUNK = update({
	sessionUpdate: "agent_message_chunk",
	content: { type: "text", text: "I'll analyze your code for potential issues. Let me examine it..." },
});
/** protocol/v1/draft/tool-calls, "Creating" */
export const TOOL_CALL = update({
	sessionUpdate: "tool_call",
	toolCallId: "call_001",
	title: "Reading configuration file",
	name: "read_file",
	kind: "read",
	status: "pending",
});
/** protocol/v1/draft/tool-calls, "Updating" */
export const TOOL_PROGRESS = update({
	sessionUpdate: "tool_call_update",
	toolCallId: "call_001",
	status: "in_progress",
	content: [{ type: "content", content: { type: "text", text: "Found 3 configuration files..." } }],
});

/**
 * agy's questions as plan §3.5 describes them (`qN`, `qN_other`), each property as the v1 schema's own
 * `StringPropertySchema` (titled `oneOf`) and `MultiSelectPropertySchema` (titled `items.anyOf`) write it.
 */
export const QUESTIONS = {
	jsonrpc: "2.0",
	id: 44,
	method: "elicitation/create",
	params: {
		sessionId: SESSION,
		mode: "form",
		message: "How should I refactor this?",
		requestedSchema: {
			type: "object",
			properties: {
				q1: {
					type: "string",
					title: "Approach",
					oneOf: [
						{ const: "conservative", title: "Conservative (Recommended)" },
						{ const: "aggressive", title: "Aggressive" },
					],
				},
				q2: {
					type: "array",
					title: "Areas",
					items: {
						anyOf: [
							{ const: "api", title: "API", description: "Routes and handlers" },
							{ const: "ui", title: "UI" },
						],
					},
				},
				q2_other: { type: "string", title: "Other" },
			},
			required: ["q1"],
		},
	},
};

export function session() {
	const sent: Array<Record<string, unknown>> = [];
	const rpc = new JsonRpc(
		"agy",
		(record) => sent.push(JSON.parse(record)),
		() => undefined,
	);
	const live = new LiveState(emptySnapshot(), () => 1_000);
	const initial = live.snapshot();
	const records: SinkRecord[] = [];
	live.attach({ emit: (record) => records.push(record) });
	const prompts: Array<{ prompt: readonly object[]; answer: (result: RpcResult<PromptAnswer>) => void }> = [];
	const counts = { cancels: 0, ran: 0 };
	const asks = new AgyAsks({
		emit: (record) => live.emit(record.event, record.native, record.at),
		stopRun: () => turns.abort(),
		now: () => 1_000,
	});
	const turns: Turns = new Turns({
		sessionId: SESSION,
		asks,
		prompts: new PhonePrompts(async (data, mimeType) => ({
			ok: true,
			data,
			mimeType,
			originalBytes: 3,
			resized: false,
		})),
		emit: (event) => live.emit(event),
		snapshot: () => live.snapshot(),
		request: (prompt) => new Promise((answer) => prompts.push({ prompt, answer })),
		cancel: () => {
			counts.cancels += 1;
		},
		commands: () => undefined,
		turnUsage: () => undefined,
		ran: () => {
			counts.ran += 1;
		},
		sent: () => undefined,
	});
	rpc.attach(SESSION, {
		update: (body) => turns.update(body),
		call: (call) => turns.call(call),
		fault: () => undefined,
	});
	const agy = (record: object) => rpc.receive({ kind: "line", text: JSON.stringify(record) });
	const ends = async (stopReason: string) => {
		prompts.at(-1)?.answer({ ok: true, result: { stopReason } });
		await Bun.sleep(0);
	};
	const types = () => records.map((record) => record.event.type);
	const violations = () => streamViolations(records, ANTIGRAVITY_TRAITS, initial);
	return { turns, asks, live, sent, prompts, counts, agy, ends, types, violations, records };
}

export function start(text: string) {
	return { clientRequestId: crypto.randomUUID(), mode: "start" as const, text, attachments: [] };
}

export function pendingAsk(live: LiveState): Interaction {
	const ask = live.snapshot().interactions[0];
	if (ask === undefined) throw new Error("no ask is pending");
	return ask;
}
