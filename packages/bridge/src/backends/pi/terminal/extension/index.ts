// broski-link-extension v2: written by the Broski bridge; delete it, or set "pi.terminalLink": false in the bridge's config.
//
// Lets the Broski app on your phone follow this terminal's session live, stop it or send it a message, and answer what
// it asks (`dialogs.ts`): a question shows in the terminal and on the phone, and the first answer wins. It runs in
// the terminal's own `pi` process and does nothing unless the Broski bridge is running on this machine: no output, no
// work on Pi's event paths beyond copying a few fields, a bounded buffer, and a timer that never keeps `pi` alive.
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Link } from "./link";
import { clip, compact, endedMessage, type Frame, MAX_TEXT, toolResult } from "./projection";

function guarded(work: () => void): void {
	try {
		work();
	} catch {
		// Nothing here may reach Pi: a throw in an event handler is reported in the terminal.
	}
}

function at(stream: { type: string; contentIndex: number }): Frame {
	return { type: stream.type, contentIndex: stream.contentIndex };
}

/** The wire form of a streamed assistant event; nothing for the ones the bridge does not use. */
function streamEvent(stream: AssistantMessageEvent): Frame | undefined {
	switch (stream.type) {
		case "text_start":
		case "thinking_start":
			return at(stream);
		case "text_delta":
		case "thinking_delta":
			return { ...at(stream), delta: stream.delta };
		case "text_end":
		case "thinking_end":
			return { ...at(stream), content: clip(stream.content, MAX_TEXT) };
		case "toolcall_start": {
			const call = stream.partial.content[stream.contentIndex];
			return call?.type === "toolCall" ? { ...at(stream), id: call.id, toolName: call.name } : undefined;
		}
		case "toolcall_end": {
			const { id, name, arguments: args } = stream.toolCall;
			return { ...at(stream), toolCall: { type: "toolCall", id, name, arguments: compact(args) } };
		}
	}
}

export default function brokskiLink(pi: ExtensionAPI): void {
	const link = new Link(pi);
	forwardRun(pi, link);
	forwardTools(pi, link);
	forwardSession(pi, link);
	pi.events.on("broski:tasks", (tasks) => guarded(() => link.tasksChanged(compact(tasks ?? []))));
	pi.events.on("broski:questions", (request) => guarded(() => link.dialogs.questions(request)));
}

function forwardRun(pi: ExtensionAPI, link: Link): void {
	pi.on("session_start", (_event, ctx) => guarded(() => link.begin(ctx)));
	pi.on("session_shutdown", (event) => guarded(() => link.end(event.reason)));
	pi.on("agent_start", (_event, ctx) =>
		guarded(() => link.emit(ctx, { e: "agent_start", leafId: ctx.sessionManager.getLeafId() })),
	);
	pi.on("agent_settled", (event, ctx) => guarded(() => link.emit(ctx, { e: "agent_settled", aborted: event.aborted })));
	pi.on("message_start", (event, ctx) =>
		guarded(() => {
			const role = event.message.role;
			link.emit(ctx, {
				e: "message_start",
				role: role === "user" || role === "assistant" || role === "toolResult" ? role : "other",
			});
		}),
	);
	pi.on("message_update", (event, ctx) =>
		guarded(() => {
			const ev = streamEvent(event.assistantMessageEvent);
			if (ev !== undefined) link.emit(ctx, { e: "stream", ev });
		}),
	);
	pi.on("message_end", (event, ctx) =>
		guarded(() => link.emit(ctx, { e: "message_end", message: endedMessage(event.message) })),
	);
}

function forwardTools(pi: ExtensionAPI, link: Link): void {
	pi.on("tool_execution_start", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, {
				e: "tool_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: compact(event.args),
				...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
			}),
		),
	);
	pi.on("tool_execution_update", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, {
				e: "tool_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: compact(event.args),
				partialResult: toolResult(event.partialResult),
				...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
			}),
		),
	);
	pi.on("tool_execution_end", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, {
				e: "tool_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: toolResult(event.result),
				isError: event.isError,
				...(event.parentToolCallId !== undefined && { parentToolCallId: event.parentToolCallId }),
			}),
		),
	);
}

function forwardSession(pi: ExtensionAPI, link: Link): void {
	pi.on("model_select", (event, ctx) =>
		guarded(() => link.emit(ctx, { e: "model", provider: event.model.provider, id: event.model.id })),
	);
	pi.on("thinking_level_select", (event, ctx) => guarded(() => link.emit(ctx, { e: "thinking", level: event.level })));
	pi.on("session_info_changed", (_event, ctx) => guarded(() => link.emit(ctx, { e: "name" })));
	pi.on("session_before_compact", (event, ctx) =>
		guarded(() => link.emit(ctx, { e: "compaction_start", reason: event.reason })),
	);
	pi.on("session_compact", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, {
				e: "compaction_end",
				reason: event.reason,
				outcome: "completed",
				tokensBefore: event.compactionEntry.tokensBefore,
			}),
		),
	);
	pi.on("session_compact_failed", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, {
				e: "compaction_end",
				reason: event.reason,
				outcome: event.aborted ? "aborted" : "failed",
				...(event.errorMessage !== undefined && { error: clip(event.errorMessage, MAX_TEXT) }),
			}),
		),
	);
	pi.on("ui_prompt_start", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, { e: "ui_prompt", phase: "start", ...(event.title && { title: clip(event.title, 1_000) }) }),
		),
	);
	pi.on("ui_prompt_end", (event, ctx) =>
		guarded(() =>
			link.emit(ctx, { e: "ui_prompt", phase: "end", ...(event.title && { title: clip(event.title, 1_000) }) }),
		),
	);
}
