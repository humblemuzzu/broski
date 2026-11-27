/**
 * The items a `session/load` replay makes, oldest first. agy 1.5.18 replays the user's text, the agent's text and the
 * tool calls with their answers, but no message ids, times, thinking or images: a run of chunks of one kind is one
 * item, ids are positions (`<sessionId>:<n>`), and every item carries the session's last update as its time. A tool
 * call's items show the call as agy last reported it.
 */

import { phoneText } from "../../../adapter-kit/phone-text";
import { MAX_ID_CHARS, type TranscriptItem } from "../../../contract";
import type { SessionUpdate } from "../acp/frames";
import { type ToolEnd, type ToolState, toolEnd, toolLook, toolState } from "../mapping/tools";

interface Tool {
	state: ToolState;
	end: ToolEnd | undefined;
}

type Entry =
	| { readonly kind: "user" | "text" | "thinking"; text: string }
	| { readonly kind: "tool_call"; readonly tool: Tool }
	| { readonly kind: "tool_result"; readonly tool: Tool; readonly end: ToolEnd };

const CHUNKS = { user_message_chunk: "user", agent_message_chunk: "text", agent_thought_chunk: "thinking" } as const;

export class ReplayItems {
	private readonly entries: Entry[] = [];
	private readonly tools = new Map<string, Tool>();
	private faults = 0;

	add(update: SessionUpdate): void {
		switch (update.sessionUpdate) {
			case "user_message_chunk":
			case "agent_message_chunk":
			case "agent_thought_chunk":
				if (update.content.type === "text") this.chunk(CHUNKS[update.sessionUpdate], update.content.text ?? "");
				return;
			case "tool_call":
			case "tool_call_update":
				this.tool(update);
				return;
		}
	}

	/** A replayed update that did not read; the transcript says how many there were. */
	fault(): void {
		this.faults += 1;
	}

	items(sessionId: string, at: number): TranscriptItem[] {
		const items = this.entries.map((entry, index) => itemOf(entry, `${sessionId}:${index}`, index, at));
		if (this.faults === 0) return items;
		const what = this.faults === 1 ? "1 replayed update was" : `${this.faults} replayed updates were`;
		const text = `${what} not readable and not shown.`;
		return [...items, { kind: "notice", id: `${sessionId}:${items.length}`, at, level: "warning", text }];
	}

	private chunk(kind: "user" | "text" | "thinking", text: string): void {
		const last = this.entries.at(-1);
		if (last !== undefined && last.kind === kind && "text" in last) last.text += text;
		else this.entries.push({ kind, text });
	}

	private tool(update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>): void {
		const { toolCallId } = update;
		if (toolCallId === "" || toolCallId.length > MAX_ID_CHARS) return;
		let tool = this.tools.get(toolCallId);
		if (tool === undefined) {
			tool = { state: toolState(update), end: undefined };
			this.tools.set(toolCallId, tool);
			this.entries.push({ kind: "tool_call", tool });
		} else tool.state = toolState(update, tool.state);
		const end = toolEnd(tool.state);
		if (end !== undefined && tool.end === undefined) this.entries.push({ kind: "tool_result", tool, end });
		tool.end = end ?? tool.end;
	}
}

function itemOf(entry: Entry, id: string, index: number, at: number): TranscriptItem {
	switch (entry.kind) {
		case "user":
			return { kind: "user_message", id, at, text: phoneText(entry.text), attachments: [] };
		case "text":
		case "thinking":
			return { kind: "block", id, at, messageId: `message-${index}`, block: entry.kind, text: phoneText(entry.text) };
		case "tool_call":
			return { kind: "tool_call", id, at, toolCallId: entry.tool.state.toolCallId, ...toolLook(entry.tool.state) };
		case "tool_result":
			return { kind: "tool_result", id, at, toolCallId: entry.tool.state.toolCallId, ...(entry.tool.end ?? entry.end) };
	}
}
