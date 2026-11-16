/**
 * One live assistant message's stream (`message_update`, `message_end`) as contract events: text and
 * thinking blocks keyed by `contentIndex`, and the tool calls it streams.
 */

import {
	type AgentEvent,
	MAX_TEXT_CHARS,
	type MessageId,
	type ToolCallId,
	type ToolStartedEvent,
} from "../../../contract";
import { clipStart } from "../bounds";
import { blockId, type ToolCallIds } from "../ids";
import type { AssistantMessage, ToolCall } from "../messages";
import { type BlockType, OpenBlock } from "./open-block";
import type { StreamEvent } from "./stream-event";
import { toolInputOf, toolStartedOfCall } from "./tool-items";

/** A call this stream reported as started: Pi's id for it and the live id it got. */
interface StartedCall {
	readonly piId: string;
	readonly id: ToolCallId;
}

export class AssistantStream {
	private readonly open = new Map<number, OpenBlock>();
	private readonly closed = new Set<number>();
	private readonly calls: StartedCall[] = [];

	constructor(
		readonly messageId: MessageId,
		private readonly tools: ToolCallIds,
	) {}

	/** The events one `message_update.assistantMessageEvent` adds. */
	update(event: StreamEvent): AgentEvent[] {
		switch (event.type) {
			case "text_start":
				return this.begin(event.contentIndex, "text");
			case "thinking_start":
				return this.begin(event.contentIndex, "thinking");
			case "text_delta":
			case "thinking_delta":
				return this.append(event.contentIndex, event.delta);
			case "text_end":
				return this.finish(event.contentIndex, "text", event.content);
			case "thinking_end":
				return this.finish(event.contentIndex, "thinking", event.content);
			case "toolcall_start":
				return this.startCall({ id: event.id, name: event.toolName });
			case "toolcall_end":
				return this.endCall(event.toolCall);
		}
	}

	/**
	 * Closes every block still open with the final message's text (`message_end` is the authoritative message,
	 * pi-coding-agent 1.5.2 `docs/json.md:68, 93`). A non-empty block the stream never
	 * opened, which a provider that sent the message whole never does, is started and finished here.
	 * Tool calls are not touched: a call no stream started starts at its `tool_execution_start`.
	 */
	end(message: AssistantMessage): AgentEvent[] {
		const events: AgentEvent[] = [];
		message.content.forEach((block, index) => {
			if (block.type === "text") events.push(...this.finish(index, "text", block.text));
			if (block.type === "thinking") events.push(...this.finish(index, "thinking", block.thinking));
		});
		return [...events, ...this.abandon()];
	}

	/**
	 * The live ids of calls this stream started that Pi will never run, so no `tool_execution_*` event will
	 * finish them: every call of a message that stopped `error` or `aborted` (the agent loop executes none of
	 * them, pi-agent-core 1.5.2 `dist/agent-loop.js:146-156`), and a started call the final
	 * message does not hold. Call it with the message `end` was given; whoever owns the run finishes
	 * exactly these, `aborted`.
	 */
	unexecutedCalls(message: AssistantMessage): ToolCallId[] {
		const noneRun = message.stopReason === "error" || message.stopReason === "aborted";
		const final = new Set(message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : [])));
		return this.calls.filter((call) => noneRun || !final.has(call.piId)).map((call) => call.id);
	}

	/**
	 * Brings the open blocks up to `blocks`, what the message holds now after events were lost: their text grown, or
	 * new ones. Undefined when `blocks` cannot be this message's: a block gone, changed, or reopened.
	 */
	catchUp(
		blocks: readonly { readonly index: number; readonly kind: BlockType; readonly text: string }[],
	): AgentEvent[] | undefined {
		const listed = new Map(blocks.map((block) => [block.index, block]));
		for (const [index, block] of this.open) {
			const now = listed.get(index);
			if (now === undefined || now.kind !== block.kind || !now.text.startsWith(block.text())) return undefined;
		}
		if (blocks.some((block) => this.closed.has(block.index))) return undefined;
		return blocks.flatMap((block) => {
			const open = this.open.get(block.index);
			if (open) return this.append(block.index, block.text.slice(open.text().length));
			return [...this.begin(block.index, block.kind), ...this.append(block.index, block.text)];
		});
	}

	/** Pi's ids of the calls this message has streamed so far. */
	streamedCalls(): string[] {
		return this.calls.map((call) => call.piId);
	}

	/** Closes every block still open as it stands: the run ended without this message's `message_end`. */
	abandon(): AgentEvent[] {
		return [...this.open].flatMap(([index, block]) => this.finish(index, block.kind, block.text()));
	}

	private begin(index: number, kind: BlockType): AgentEvent[] {
		if (this.open.has(index) || this.closed.has(index)) return [];
		this.open.set(index, new OpenBlock(kind));
		return [{ type: "block_started", blockId: blockId(this.messageId, index), messageId: this.messageId, kind }];
	}

	private append(index: number, delta: string): AgentEvent[] {
		const block = this.open.get(index);
		if (!block || delta === "") return [];
		const text = clipStart(delta, MAX_TEXT_CHARS);
		block.add(text);
		return [{ type: "block_delta", blockId: blockId(this.messageId, index), text }];
	}

	private finish(index: number, kind: BlockType, authoritative: string): AgentEvent[] {
		const events = this.open.has(index) || authoritative === "" ? [] : this.begin(index, kind);
		const block = this.open.get(index);
		if (!block) return [];
		this.open.delete(index);
		this.closed.add(index);
		return [...events, ...finishedEvents(blockId(this.messageId, index), block, authoritative)];
	}

	/**
	 * openai-completions announces a call before its id and name arrive (pi-ai 1.5.2 `dist/api/openai-completions.js:296-321`),
	 * and `toolcall_start` then carries empty ones: such a call starts at its `toolcall_end`.
	 */
	private startCall(call: Pick<ToolCall, "id" | "name">): AgentEvent[] {
		return call.id === "" || call.name === "" ? [] : [this.started(call)];
	}

	private endCall(toolCall: Pick<ToolCall, "id" | "name" | "arguments">): AgentEvent[] {
		const known = this.calls.some((call) => call.piId === toolCall.id);
		const input = toolInputOf(toolCall, this.tools);
		return known ? [input] : [this.started(toolCall), input];
	}

	private started(call: Pick<ToolCall, "id" | "name">): ToolStartedEvent {
		const event = toolStartedOfCall(call, this.messageId, this.tools);
		this.calls.push({ piId: call.id, id: event.toolCallId });
		return event;
	}
}

/**
 * Stream rule 3: a block that streamed deltas finishes with exactly their text. The authoritative text
 * can differ (OpenAI Responses joins a reasoning summary's parts without the `\n\n` its deltas added,
 * pi-ai 1.5.2 `dist/api/openai-responses-shared.js:550-561, 631`); text the deltas fell short of is sent as a last
 * delta, and any other difference leaves the streamed text, which the transcript read at `run_finished`
 * replaces with the stored one.
 */
function finishedEvents(id: string, block: OpenBlock, authoritative: string): AgentEvent[] {
	const text = clipStart(authoritative, MAX_TEXT_CHARS);
	const streamed = block.text();
	if (!block.deltas || text === streamed) return [{ type: "block_finished", blockId: id, text }];
	if (!text.startsWith(streamed)) return [{ type: "block_finished", blockId: id, text: streamed }];
	return [
		{ type: "block_delta", blockId: id, text: text.slice(streamed.length) },
		{ type: "block_finished", blockId: id, text },
	];
}
