/** The parts of Pi's `assistantMessageEvent` the adapter reads, without the cumulative `partial` (Pi's own JSON mode drops it too). */

import type { AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";

export type StreamEvent =
	| { readonly type: "text_start" | "thinking_start"; readonly contentIndex: number }
	| { readonly type: "text_delta" | "thinking_delta"; readonly contentIndex: number; readonly delta: string }
	| { readonly type: "text_end" | "thinking_end"; readonly contentIndex: number; readonly content: string }
	| {
			readonly type: "toolcall_start";
			readonly contentIndex: number;
			/** Pi's id and name for the call, which `partial` holds at `contentIndex`. */
			readonly id: string;
			readonly toolName: string;
	  }
	| {
			readonly type: "toolcall_end";
			readonly contentIndex: number;
			readonly toolCall: Pick<ToolCall, "id" | "name" | "arguments">;
	  };

/**
 * `event` as a `StreamEvent`; undefined for the ones that carry nothing the adapter uses, and for a call started before
 * its id and name arrive (openai-completions does, pi-ai `src/api/openai-completions.ts:502-515, 659-664`).
 * `partial` is the provider's live response-so-far, shared and mutated in place (pi-agent-core `src/agent-loop.ts:442-449`):
 * only `toolcall_start`'s call is read from it, as Pi's JSON mode does (pi-coding-agent `src/modes/json-event.ts:23-30`).
 */
export function streamEventOf(event: AssistantMessageEvent): StreamEvent | undefined {
	switch (event.type) {
		case "text_start":
		case "thinking_start":
			return { type: event.type, contentIndex: event.contentIndex };
		case "text_delta":
		case "thinking_delta":
			return { type: event.type, contentIndex: event.contentIndex, delta: event.delta };
		case "text_end":
		case "thinking_end":
			return { type: event.type, contentIndex: event.contentIndex, content: event.content };
		case "toolcall_start": {
			const call = event.partial.content[event.contentIndex];
			if (call?.type !== "toolCall" || call.id === "" || call.name === "") return undefined;
			return { type: event.type, contentIndex: event.contentIndex, id: call.id, toolName: call.name };
		}
		case "toolcall_end":
			return { type: event.type, contentIndex: event.contentIndex, toolCall: event.toolCall };
		case "start":
		case "toolcall_delta":
		case "done":
		case "error":
			return undefined;
	}
}
