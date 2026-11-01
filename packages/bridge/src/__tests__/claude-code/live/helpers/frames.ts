/** Frames as the CLI writes them, for driving a host through a `FakeQuery`; each is only what the host reads of it. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const SESSION = "00000000-0000-4000-8000-000000000001";

/** JSON.parse yields `any`, so a frame built from what the host reads needs no cast to be an `SDKMessage`. */
export function frame(value: object): SDKMessage {
	return JSON.parse(JSON.stringify({ session_id: SESSION, uuid: crypto.randomUUID(), ...value }));
}

export const running = () => frame({ type: "system", subtype: "session_state_changed", state: "running" });
export const idle = () => frame({ type: "system", subtype: "session_state_changed", state: "idle" });
export const requiresAction = () =>
	frame({ type: "system", subtype: "session_state_changed", state: "requires_action" });

export const init = (extra: { model?: string; permissionMode?: string } = {}) =>
	frame({ type: "system", subtype: "init", model: "claude-opus-5-5", permissionMode: "default", ...extra });

export const status = (extra: object) => frame({ type: "system", subtype: "status", status: null, ...extra });

export const result = (extra: { subtype?: string; terminal_reason?: string; is_error?: boolean } = {}) =>
	frame({ type: "result", subtype: "success", is_error: false, terminal_reason: "completed", ...extra });

export const lifecycle = (state: string, commandUuid: string) =>
	frame({ type: "command_lifecycle", state, command_uuid: commandUuid });

export const assistant = (uuid = crypto.randomUUID(), extra: object = {}) =>
	frame({
		type: "assistant",
		uuid,
		parent_tool_use_id: null,
		message: { id: "msg_1", role: "assistant", content: [{ type: "text", text: "hi" }] },
		...extra,
	});

export const userEntry = (uuid = crypto.randomUUID(), extra: object = {}) =>
	frame({ type: "user", uuid, parent_tool_use_id: null, message: { role: "user", content: [] }, ...extra });

export const streamEvent = () =>
	frame({
		type: "stream_event",
		parent_tool_use_id: null,
		event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } },
	});

export const backgroundTasks = (tasks: object[]) =>
	frame({ type: "system", subtype: "background_tasks_changed", tasks });

export const conversationReset = (newConversationId: string) =>
	frame({ type: "conversation_reset", new_conversation_id: newConversationId, trigger: "clear" });
