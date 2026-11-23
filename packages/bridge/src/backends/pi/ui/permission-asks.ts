/**
 * A tool call the bridge's extension holds until the phone decides (`host/extension/index.ts`), as a
 * `tool_permission` interaction, and the human's decision as the verdict the extension acts on. Denying blocks the
 * call with the reason the model reads; denying and stopping also stops the run, through the host's own abort.
 */

import type { InteractionReply, JsonValue } from "../../../contract";
import type { PermissionAsk, PermissionVerdict } from "../host/protocol";
import type { RunContext } from "../ports";
import type { AskOutcome, InteractionDesk } from "./interactions";
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

export interface PermissionHost {
	readonly desk: InteractionDesk;
	/** The run the call belongs to; a gate asks only inside one. */
	activeRun(): RunContext | undefined;
	/** The human allowed the tool for the session: the extension records it, and the host's modes follow. */
	allowedForSession(toolName: string): void;
	abortRun(): void;
	/** `undefined` answers the extension's dialog with no verdict, which blocks the call. */
	reply(verdict: PermissionVerdict | undefined): void;
}

export async function askPermission(ask: PermissionAsk, host: PermissionHost): Promise<void> {
	const run = host.activeRun();
	const outcome = await host.desk.ask({
		title: permissionTitle(ask.toolName),
		request: permissionRequest(ask),
		origin: permissionOrigin(ask, run?.tools),
		...(run !== undefined && { run }),
		replyProblem: editProblem,
	});
	host.reply(verdictOf(ask, outcome, run, host));
}

function verdictOf(
	ask: PermissionAsk,
	outcome: AskOutcome,
	run: RunContext | undefined,
	host: PermissionHost,
): PermissionVerdict | undefined {
	if (outcome.kind === "ended") return undefined;
	const { reply } = outcome;
	const deny = (message: string | undefined, fallback: string): PermissionVerdict => {
		run?.tools.deny(ask.toolCallId);
		const words = message?.trim();
		return { decision: "deny", message: words ? `${fallback} They said: ${words}` : fallback };
	};
	// The human's words reach the model after what they did, so it never reads them as the tool's own output.
	if (reply.kind === "cancel") return deny(reply.message, DISMISSED);
	if (reply.kind !== "tool_permission") return undefined;
	switch (reply.optionId) {
		case ALLOW_ONCE:
			return allow("allow", reply.editedInput);
		case ALLOW_SESSION:
			host.allowedForSession(ask.toolName);
			return allow("allow_session", reply.editedInput);
		case DENY:
			return deny(reply.message, DENIED);
		case DENY_STOP:
			host.abortRun();
			return deny(reply.message, DENIED);
		default:
			return undefined;
	}
}

function allow(decision: "allow" | "allow_session", input: JsonValue | undefined): PermissionVerdict {
	return input === undefined ? { decision } : { decision, input };
}

/** Pi checks an edit against the tool in the extension; what no tool can take is refused here, before it is sent. */
function editProblem(reply: InteractionReply): string | undefined {
	if (reply.kind !== "tool_permission" || reply.editedInput === undefined) return undefined;
	const edited = reply.editedInput;
	if (typeof edited !== "object" || edited === null || Array.isArray(edited))
		return "an edited input must be an object";
	return Object.hasOwn(edited, "__proto__") ? "an edited input cannot have a __proto__ key" : undefined;
}
