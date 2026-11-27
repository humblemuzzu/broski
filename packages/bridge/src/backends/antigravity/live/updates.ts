/**
 * What one run streams, as the contract's events: `agent_message_chunk` and `agent_thought_chunk` as text and thinking
 * blocks (a block closes when the kind changes, a tool call starts or the run ends), and each tool call as
 * `tool_started`, `tool_updated` and `tool_finished` through the one tool mapper the transcript uses (an update's
 * `content` replaces the call's whole, as ACP `tool_call_update` says). Whatever is still open when the run ends is
 * closed first.
 */

import { boundedJson } from "../../../adapter-kit/bounded-json";
import { phoneText } from "../../../adapter-kit/phone-text";
import { type AgentEvent, MAX_ID_CHARS, MAX_TEXT_CHARS, type ToolUpdate } from "../../../contract";
import type { SessionUpdate } from "../acp/frames";
import { fileChangesOf, type ToolState, toolEnd, toolLook, toolOutput, toolState } from "../mapping/tools";

type ToolUpdateFrame = Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>;

interface OpenBlock {
	readonly blockId: string;
	readonly kind: "text" | "thinking";
	text: string;
}

interface Tool {
	/** The id the contract knows the call by. */
	readonly id: string;
	state: ToolState;
	finished: boolean;
}

/** agy's tool call ids, once given, map to ids never given before in the session, across its runs. */
export class ToolIds {
	private readonly used = new Set<string>();

	mint(agyId: string): string {
		let id = agyId;
		for (let n = 2; this.used.has(id); n += 1) id = `${agyId}#${n}`;
		this.used.add(id);
		return id;
	}
}

export class TurnStream {
	private block: OpenBlock | undefined;
	private messageId: string | undefined;
	private readonly tools = new Map<string, Tool>();

	constructor(
		private readonly emit: (event: AgentEvent) => void,
		private readonly ids: ToolIds,
	) {}

	chunk(kind: "text" | "thinking", text: string): void {
		const delta = phoneText(text);
		if (delta === "") return;
		if (
			this.block !== undefined &&
			(this.block.kind !== kind || this.block.text.length + delta.length > MAX_TEXT_CHARS)
		) {
			this.closeBlock();
		}
		const block = this.block ?? this.openBlock(kind);
		block.text += delta;
		this.emit({ type: "block_delta", blockId: block.blockId, text: delta });
	}

	/** The call as agy reported it so far, by agy's id; with the contract's id for it. */
	tool(agyId: string): { readonly id: string; readonly state: ToolState } | undefined {
		return this.tools.get(agyId);
	}

	/** Returns whether the call has ended, so an ask waiting on it is withdrawn. */
	toolUpdate(update: ToolUpdateFrame): boolean {
		const { toolCallId } = update;
		if (toolCallId === "" || toolCallId.length > MAX_ID_CHARS) return false;
		const known = this.tools.get(toolCallId);
		if (known?.finished) return true;
		if (known === undefined) this.startTool(update);
		else this.updateTool(known, update);
		return this.tools.get(toolCallId)?.finished === true;
	}

	/** Closes the open block, and ends every call still running as stopped with the run. */
	close(): void {
		this.closeBlock();
		for (const tool of this.tools.values()) {
			if (tool.finished) continue;
			tool.finished = true;
			const output = toolOutput(tool.state);
			this.emit({
				type: "tool_finished",
				toolCallId: tool.id,
				outcome: "aborted",
				result: {
					content: output === "" ? [] : [{ kind: "text", text: output }],
					fileChanges: fileChangesOf(tool.state.content),
				},
			});
		}
	}

	private openBlock(kind: "text" | "thinking"): OpenBlock {
		this.messageId ??= crypto.randomUUID();
		const block = { blockId: crypto.randomUUID(), kind, text: "" };
		this.block = block;
		this.emit({ type: "block_started", blockId: block.blockId, messageId: this.messageId, kind });
		return block;
	}

	private closeBlock(): void {
		const block = this.block;
		if (block === undefined) return;
		this.block = undefined;
		this.emit({ type: "block_finished", blockId: block.blockId, text: block.text });
	}

	/** A call agy first names in a `tool_call_update` starts there too. */
	private startTool(update: ToolUpdateFrame): void {
		this.closeBlock();
		this.messageId = undefined;
		const tool: Tool = { id: this.ids.mint(update.toolCallId), state: toolState(update), finished: false };
		this.tools.set(update.toolCallId, tool);
		this.emit({ type: "tool_started", toolCallId: tool.id, ...toolLook(tool.state) });
		const before = toolState({ toolCallId: update.toolCallId });
		for (const change of toolChanges(before, tool.state, false)) {
			this.emit({ type: "tool_updated", toolCallId: tool.id, update: change });
		}
		this.finishIfEnded(tool);
	}

	/** agy 1.5.18 sends a call's arguments again with each update: only new ones are an `input` change. */
	private updateTool(tool: Tool, update: ToolUpdateFrame): void {
		const before = tool.state;
		tool.state = toolState(update, before);
		const input = update.rawInput !== undefined && JSON.stringify(update.rawInput) !== JSON.stringify(before.rawInput);
		for (const change of toolChanges(before, tool.state, input)) {
			this.emit({ type: "tool_updated", toolCallId: tool.id, update: change });
		}
		this.finishIfEnded(tool);
	}

	private finishIfEnded(tool: Tool): void {
		const end = toolEnd(tool.state);
		if (end === undefined) return;
		tool.finished = true;
		this.emit({ type: "tool_finished", toolCallId: tool.id, ...end });
	}
}

/** What changed between two reports of a call; `input`: the later one gave other arguments. */
function toolChanges(before: ToolState, after: ToolState, input: boolean): ToolUpdate[] {
	const changes: ToolUpdate[] = [];
	if (input) changes.push({ kind: "input", input: boundedJson(after.rawInput) });
	const output = toolOutput(after);
	if (output !== toolOutput(before)) changes.push({ kind: "output_replaced", text: output });
	const files = fileChangesOf(after.content);
	if (JSON.stringify(files) !== JSON.stringify(fileChangesOf(before.content))) {
		changes.push({ kind: "file_changes", changes: files });
	}
	return changes;
}
