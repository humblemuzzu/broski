import type { ClientMessage, ServerMessage } from "../types";

type Primitive = "string" | "number" | "boolean" | "array" | "object";

type FieldSpec = readonly [name: string, kind: Primitive, optional?: true];

type Schema = readonly FieldSpec[];

const string = (name: string, optional?: true): FieldSpec => (optional ? [name, "string", true] : [name, "string"]);
const number = (name: string, optional?: true): FieldSpec => (optional ? [name, "number", true] : [name, "number"]);
const array = (name: string, optional?: true): FieldSpec => (optional ? [name, "array", true] : [name, "array"]);

/**
 * Per-type message shapes. Every entry mirrors the non-optional fields declared
 * on the matching `ClientMessage` member, so a message the app can legitimately
 * send is never rejected; only a missing required field or a wrong primitive is.
 * Types absent from this table skip the shape check entirely.
 */
const SCHEMAS: Partial<Record<ClientMessage["type"], Schema>> = {
	batch: [array("messages")],

	set_view: [
		string("projectPath", true),
		string("sessionId", true),
		string("agent", true),
		number("lastRuntimeSeq", true),
	],
	set_agent: [string("agent")],
	pong: [string("id"), number("sentAt")],
	client_ping: [string("id"), number("sentAt")],

	register_device: [string("deviceId"), string("deviceName"), string("platform"), string("protocolVersion", true)],
	disconnect_device: [string("deviceId")],

	browse: [string("path"), string("projectPath", true)],
	read_file: [string("path"), string("projectPath", true)],
	read_file_binary: [string("path"), number("maxSizeMb", true)],

	abort: [string("sessionId")],
	chat: [string("sessionId"), string("content")],
	set_model: [string("model")],
	get_session: [string("sessionId")],
	delete_session: [string("sessionId")],
	permission_response: [string("sessionId"), string("permissionId"), string("response")],
	create_session: [string("projectPath", true), string("title", true)],
	list_sessions: [string("projectPath", true)],

	cc_chat: [string("prompt"), string("sessionId", true), string("cwd", true)],
	cc_abort: [string("sessionId")],
	cc_get_session: [string("sessionId"), string("cwd", true)],
	cc_get_session_messages: [string("sessionId"), string("cwd", true)],
	cc_delete_session: [string("sessionId"), string("cwd", true)],
	cc_permission_response: [string("sessionId"), string("toolUseId"), string("response")],
	cc_elicitation_response: [string("sessionId"), string("requestId"), string("action")],

	cx_chat: [string("prompt"), string("threadId", true), string("cwd", true)],
	cx_abort: [string("threadId")],
	cx_get_thread_messages: [string("threadId")],
	cx_permission_response: [string("requestId"), string("response")],
	cx_shell_command: [string("threadId"), string("command")],

	unified_list_sessions: [string("backend")],
	unified_list_projects: [string("backend")],
	unified_list_models: [string("backend")],
	unified_list_skills: [string("backend")],
	unified_set_model: [string("backend")],
	unified_abort: [string("backend")],
	unified_delete_session: [string("backend"), string("sessionId")],
	unified_list_session_children: [string("backend"), string("sessionId")],

	git_diff: [string("projectPath"), string("path", true)],
	git_status: [string("projectPath")],
	git_log: [string("projectPath")],
	git_branches: [string("projectPath")],
	git_stage: [string("projectPath")],
	git_unstage: [string("projectPath")],
	git_commit: [string("projectPath"), string("message")],
	git_push: [string("projectPath")],
	git_checkout: [string("projectPath"), string("branch")],
	git_create_branch: [string("projectPath"), string("name")],

	get_pty: [string("ptyId")],
	update_pty: [string("ptyId")],
	delete_pty: [string("ptyId")],
	pty_connect: [string("ptyId")],
	pty_disconnect: [string("ptyId")],
	pty_input: [string("ptyId"), string("data")],
	pty_resize: [string("ptyId"), number("rows"), number("cols")],
};

function matchesKind(value: unknown, kind: Primitive): boolean {
	switch (kind) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value as number);
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value);
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
	}
}

/** Returns `null` when the message matches its schema, otherwise the first failure. */
export function validateMessageShape(message: Record<string, unknown>): string | null {
	const schema = SCHEMAS[message.type as ClientMessage["type"]];
	if (!schema) return null;
	for (const [name, kind, optional] of schema) {
		const value = message[name];
		if (value === undefined || value === null) {
			if (!optional) return `missing required field "${name}"`;
			continue;
		}
		if (!matchesKind(value, kind)) return `field "${name}" must be a ${kind}`;
	}
	return null;
}

export function invalidPayloadError(reason: string): ServerMessage {
	return { type: "error", message: `Invalid message payload: ${reason}` };
}
