/**
 * Claude Code subagent inspection handlers.
 * SDK 0.2.92: listSubagents + getSubagentMessages
 *
 * These are Query-style (filesystem) operations — no live session needed.
 */
import { listSubagents, getSubagentMessages } from "@anthropic-ai/claude-agent-sdk";
import type { ServerMessage } from "../types";

type ReplyFn = (msg: ServerMessage) => void;

export async function handle(message: Record<string, unknown>, reply: ReplyFn): Promise<boolean> {
	switch (message.type) {
		case "cc_list_subagents": {
			try {
				const agents = await listSubagents(message.sessionId as string, {
					dir: message.cwd as string | undefined,
				});
				reply({ type: "cc_subagents", data: agents, requestId: message.requestId as string });
			} catch (error) {
				console.error("[cc_subagents] listSubagents error:", error);
				reply({ type: "cc_subagents", data: [], requestId: message.requestId as string });
			}
			return true;
		}
		case "cc_get_subagent_messages": {
			try {
				const messages = await getSubagentMessages(message.sessionId as string, message.agentId as string, {
					dir: message.cwd as string | undefined,
					limit: message.limit as number | undefined,
					offset: message.offset as number | undefined,
				});
				// Normalize SessionMessage[] to plain objects for wire transfer
				const data = messages.map((m) => ({
					role: m.type, // SessionMessage uses 'type' field for role
					content: m.message,
					uuid: m.uuid,
				}));
				reply({ type: "cc_subagent_messages", data, requestId: message.requestId as string });
			} catch (error) {
				console.error("[cc_subagents] getSubagentMessages error:", error);
				reply({ type: "cc_subagent_messages", data: [], requestId: message.requestId as string });
			}
			return true;
		}
		default:
			return false;
	}
}
