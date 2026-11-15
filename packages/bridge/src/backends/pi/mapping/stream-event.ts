/**
 * The parts of a `message_update`'s `assistantMessageEvent` the stream mapping reads, as `pi --mode rpc` sends them:
 * without the cumulative `partial`, and `toolcall_start` with the call's id and name (pi-coding-agent 1.5.2
 * `docs/json.md:72-93`, `dist/modes/json-event.js`). The terminal link's extension sends the same shape.
 */

import type { ToolCall } from "../messages";

export type StreamEvent =
	| { readonly type: "text_start" | "thinking_start"; readonly contentIndex: number }
	| { readonly type: "text_delta" | "thinking_delta"; readonly contentIndex: number; readonly delta: string }
	| { readonly type: "text_end" | "thinking_end"; readonly contentIndex: number; readonly content: string }
	| {
			readonly type: "toolcall_start";
			readonly contentIndex: number;
			readonly id: string;
			readonly toolName: string;
	  }
	| {
			readonly type: "toolcall_end";
			readonly contentIndex: number;
			readonly toolCall: Pick<ToolCall, "id" | "name" | "arguments">;
	  };
