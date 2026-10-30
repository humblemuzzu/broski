/**
 * The hidden extension behind the `permissions` axis (D14): with `ask`, every `tool_call` waits for a
 * `tool_permission` answer and is blocked or allowed. Its handler never throws: a throw there fails
 * the tool with the exception's text (pi-coding-agent `src/core/agent-session.ts:667-681`).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	InlineExtension,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { InteractionReply, JsonValue } from "../../../contract";
import { errorText } from "../error-text";
import type { ToolCallIds } from "../ids";
import { noticeEvent } from "../live/live-notes";
import type { AskHost, GateHost } from "../ports";
import { checkEditedInput, replaceInput } from "./edited-input";
import type { InteractionDesk } from "./interactions";
import {
	ALLOW_ONCE,
	ALLOW_SESSION,
	DENY,
	DENY_STOP,
	permissionOrigin,
	permissionRequest,
	permissionTitle,
} from "./permission-request";

const DENIED = "The user denied this tool call.";
const DISMISSED = "The user dismissed the permission request.";
const UNANSWERED = "The permission request ended before it was answered.";
const FAULT = "The permission check failed, so the tool call was blocked.";
const BAD_EDIT = "The edited input did not fit the tool, so the tool call was blocked.";

export function permissionGateExtension(gate: GateHost, desk: InteractionDesk, host: AskHost): InlineExtension {
	const handler = new ToolCallGate(gate, desk, host);
	return {
		name: "broski-permissions",
		hidden: true,
		factory: (pi) => {
			pi.on("tool_call", (event, ctx) => handler.handle(pi, event, ctx));
		},
	};
}

class ToolCallGate {
	constructor(
		private readonly gate: GateHost,
		private readonly desk: InteractionDesk,
		private readonly host: AskHost,
	) {}

	async handle(
		pi: ExtensionAPI,
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> {
		try {
			return await this.decide(pi, event, ctx);
		} catch (error) {
			this.host.live.emit(noticeEvent("error", `The permission check failed: ${errorText(error)}`));
			return { block: true, reason: FAULT };
		}
	}

	private async decide(
		pi: ExtensionAPI,
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> {
		if (this.gate.permissions() === "off" || this.gate.allowed(event.toolName)) return undefined;
		const run = this.host.activeRun();
		const tools = run?.tools;
		const outcome = await this.desk.ask(
			{
				title: permissionTitle(event.toolName),
				request: permissionRequest(event, ctx.cwd),
				origin: permissionOrigin(event, tools),
				...(run !== undefined && { run }),
				replyProblem: (reply) => editProblem(pi, event, reply),
			},
			{ signal: ctx.signal },
		);
		return outcome.kind === "ended"
			? { block: true, reason: UNANSWERED }
			: this.verdict(pi, event, tools, outcome.reply);
	}

	private verdict(
		pi: ExtensionAPI,
		event: ToolCallEvent,
		tools: ToolCallIds | undefined,
		reply: InteractionReply,
	): ToolCallEventResult | undefined {
		if (reply.kind === "cancel") return refuse(event, tools, reply.message ?? DISMISSED);
		if (reply.kind !== "tool_permission") return { block: true, reason: FAULT };
		switch (reply.optionId) {
			case ALLOW_ONCE:
				return allow(pi, event, reply.editedInput);
			case ALLOW_SESSION: {
				const blocked = allow(pi, event, reply.editedInput);
				if (blocked === undefined) this.gate.allowForSession(event.toolName);
				return blocked;
			}
			case DENY:
				return refuse(event, tools, reply.message ?? DENIED);
			case DENY_STOP:
				this.host.abortRun();
				return refuse(event, tools, reply.message ?? DENIED);
			default:
				return { block: true, reason: FAULT };
		}
	}
}

function refuse(event: ToolCallEvent, tools: ToolCallIds | undefined, reason: string): ToolCallEventResult {
	tools?.deny(event.toolCallId);
	return { block: true, reason: reason.trim() === "" ? DENIED : reason };
}

function allow(pi: ExtensionAPI, event: ToolCallEvent, edited: JsonValue | undefined): ToolCallEventResult | undefined {
	if (edited === undefined) return undefined;
	const checked = checkEditedInput(pi.getAllTools(), event, edited);
	if ("problem" in checked) return { block: true, reason: BAD_EDIT };
	replaceInput(event.input, checked.input);
	return undefined;
}

function editProblem(pi: ExtensionAPI, event: ToolCallEvent, reply: InteractionReply): string | undefined {
	if (reply.kind !== "tool_permission" || reply.editedInput === undefined) return undefined;
	try {
		const checked = checkEditedInput(pi.getAllTools(), event, reply.editedInput);
		return "problem" in checked ? checked.problem : undefined;
	} catch {
		return "the edited input could not be checked";
	}
}
