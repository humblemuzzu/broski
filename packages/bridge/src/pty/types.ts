import type { ClientMessage, ServerMessage } from "../types";

export type PtyClientMessage = Extract<
	ClientMessage,
	{
		type:
			| "list_pty"
			| "create_pty"
			| "get_pty"
			| "update_pty"
			| "delete_pty"
			| "pty_connect"
			| "pty_disconnect"
			| "pty_input"
			| "pty_resize";
	}
>;

export type PtyReply = (message: ServerMessage) => void;

const PTY_MESSAGE_TYPES = new Set<string>([
	"list_pty",
	"create_pty",
	"get_pty",
	"update_pty",
	"delete_pty",
	"pty_connect",
	"pty_disconnect",
	"pty_input",
	"pty_resize",
]);

export function isPtyClientMessage(message: ClientMessage): message is PtyClientMessage {
	return PTY_MESSAGE_TYPES.has(message.type);
}
