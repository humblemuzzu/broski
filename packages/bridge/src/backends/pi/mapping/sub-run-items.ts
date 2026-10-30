/**
 * A sub-run (`sub-runs.ts`) as the contract shows a session: transcript items for a child read from its parent's
 * file, and the events of the same messages for a child watched while its tool runs. Both name a message
 * `s<run>.m<index>` and its parts `<message>:<block>`, so what the stream showed is what the transcript shows.
 */

import type { AgentEvent, ToolOutcome, ToolResult, TranscriptItem } from "../../../contract";
import { blockId } from "../ids";
import type { SubBlock, SubMessage, SubRun } from "./sub-runs";

const messageIdOf = (run: number, index: number): string => `s${run}.m${index}`;
const partId = (messageId: string, block: number): string => `${messageId}:${block}`;

function resultOf(message: Extract<SubMessage, { role: "toolResult" }>): { outcome: ToolOutcome; result: ToolResult } {
	return message.isError
		? { outcome: "failed", result: { content: [], fileChanges: [], error: message.text } }
		: {
				outcome: "completed",
				result: { content: message.text === "" ? [] : [{ kind: "text", text: message.text }], fileChanges: [] },
			};
}

/** Where each of a run's tool calls sits, by the id the sub-run's own model gave it. */
function callIds(run: SubRun, runIndex: number): Map<string, string> {
	const ids = new Map<string, string>();
	run.messages.forEach((message, index) => {
		if (message.role !== "assistant") return;
		message.blocks.forEach((block, at) => {
			if (block.kind === "call") ids.set(block.id, partId(messageIdOf(runIndex, index), at));
		});
	});
	return ids;
}

/** The transcript of the sub-runs, oldest first. */
export function subRunItems(runs: readonly SubRun[], at: number | undefined): TranscriptItem[] {
	const stamp = at === undefined ? {} : { at };
	const items: TranscriptItem[] = [];
	runs.forEach((run, runIndex) => {
		if (runs.length > 1) {
			items.push({
				kind: "notice",
				id: `s${runIndex}`,
				...stamp,
				level: "info",
				text: `Run ${runIndex + 1} of ${runs.length}`,
			});
		}
		const calls = callIds(run, runIndex);
		run.messages.forEach((message, index) => {
			const messageId = messageIdOf(runIndex, index);
			if (message.role === "user") {
				items.push({ kind: "user_message", id: partId(messageId, 0), ...stamp, text: message.text, attachments: [] });
			} else if (message.role === "assistant") {
				message.blocks.forEach((block, blockAt) => {
					items.push(blockItem(block, messageId, blockAt, stamp));
				});
				if (message.failure !== undefined) {
					items.push({
						kind: "notice",
						id: partId(messageId, message.blocks.length),
						...stamp,
						level: "error",
						text: message.failure,
					});
				}
			} else {
				const { outcome, result } = resultOf(message);
				const toolCallId = calls.get(message.toolCallId) ?? partId(messageId, 0);
				items.push({ kind: "tool_result", id: partId(messageId, 0), ...stamp, toolCallId, outcome, result });
			}
		});
	});
	return items;
}

function blockItem(block: SubBlock, messageId: string, at: number, stamp: { at?: number }): TranscriptItem {
	const id = partId(messageId, at);
	return block.kind === "call"
		? { kind: "tool_call", id, ...stamp, toolCallId: id, messageId, name: block.name, input: block.input }
		: { kind: "block", id, ...stamp, messageId, block: block.kind, text: block.text };
}

/** How far a live child has been told of its sub-runs: messages per run. */
export type Told = number[];

/** The events that bring a child that was told `told` up to `runs`; `told` is advanced. */
export function subRunEvents(runs: readonly SubRun[], told: Told): AgentEvent[] {
	const events: AgentEvent[] = [];
	runs.forEach((run, runIndex) => {
		const calls = callIds(run, runIndex);
		for (let index = told[runIndex] ?? 0; index < run.messages.length; index += 1) {
			const message = run.messages[index];
			if (message !== undefined) events.push(...messageEvents(message, messageIdOf(runIndex, index), calls));
		}
		told[runIndex] = run.messages.length;
	});
	return events;
}

function messageEvents(message: SubMessage, messageId: string, calls: ReadonlyMap<string, string>): AgentEvent[] {
	if (message.role === "user") return [{ type: "user_message", messageId, text: message.text, attachments: [] }];
	if (message.role === "toolResult") {
		const toolCallId = calls.get(message.toolCallId);
		return toolCallId === undefined ? [] : [{ type: "tool_finished", toolCallId, ...resultOf(message) }];
	}
	const events: AgentEvent[] = [];
	message.blocks.forEach((block, at) => {
		if (block.kind === "call") {
			events.push({
				type: "tool_started",
				toolCallId: partId(messageId, at),
				name: block.name,
				input: block.input,
				messageId,
			});
		} else if (block.text !== "") {
			const id = blockId(messageId, at);
			events.push({ type: "block_started", blockId: id, messageId, kind: block.kind });
			events.push({ type: "block_finished", blockId: id, text: block.text });
		}
	});
	if (message.failure !== undefined) events.push({ type: "notice", level: "error", text: message.failure });
	return events;
}

/** The tool calls of `runs` that no result has finished: the child ended before they did. */
export function unfinishedCalls(runs: readonly SubRun[]): string[] {
	const open: string[] = [];
	runs.forEach((run, runIndex) => {
		const calls = callIds(run, runIndex);
		const answered = new Set(run.messages.flatMap((m) => (m.role === "toolResult" ? [m.toolCallId] : [])));
		for (const [piId, id] of calls) if (!answered.has(piId)) open.push(id);
	});
	return open;
}
