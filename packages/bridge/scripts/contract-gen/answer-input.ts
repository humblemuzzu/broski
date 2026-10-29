import type { InteractionReply, InteractionRequest, ToolPermissionRequest } from "../../src/contract";

/** One answer to check: the request asked, the reply given, and the interaction it names when not the asked one. */
export interface AnswerInput {
	readonly name: string;
	readonly request: InteractionRequest;
	readonly reply: InteractionReply;
	readonly interactionId?: string;
}

/** A permission ask with one option per message policy and an editable input. */
export const PERMISSION: ToolPermissionRequest = {
	kind: "tool_permission",
	input: { command: "ls" },
	inputEditable: true,
	previews: [{ kind: "command", command: "ls", cwd: "/tmp" }],
	options: [
		{ id: "allow", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
		{ id: "deny", label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "optional" },
		{ id: "explain", label: "Explain", effect: "deny", scope: "session", stopsRun: true, message: "required" },
	],
	grants: [],
	deliberate: false,
};
