/**
 * Claude Code subagent inspection handlers.
 * SDK 0.2.92: listSubagents + getSubagentMessages
 *
 * These are Query-style (filesystem) operations — no live session needed.
 */
import { claudeAgentSdk, loadClaudeAgentSdk } from "../sdk/claude-agent-sdk";
import type { ServerMessage } from "../types";

type TranscriptItem = {
	id: string;
	role: string;
	text: string;
	createdAt: number;
	thinking?: string;
	toolCalls?: Array<{ toolUseId: string; tool: string; input: unknown; status: string; output?: string }>;
};

type ReplyFn = (msg: ServerMessage) => void;

export async function handle(message: Record<string, unknown>, reply: ReplyFn): Promise<boolean> {
	switch (message.type) {
		case "cc_list_subagents": {
			try {
				await loadClaudeAgentSdk();
				const agents = await claudeAgentSdk().listSubagents(message.sessionId as string, {
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
				await loadClaudeAgentSdk();
				const messages = await claudeAgentSdk().getSubagentMessages(
					message.sessionId as string,
					message.agentId as string,
					{
						dir: message.cwd as string | undefined,
						limit: message.limit as number | undefined,
						offset: message.offset as number | undefined,
					},
				);
				// Normalize to same format as cc_get_session_messages (ClaudeCodeTranscriptMessage)
				// so the Flutter hydrator can use hydrateClaudeCodeTranscript() on both
				const data = messages
					.map((m, idx) => {
						const role = m.type; // 'user' | 'assistant' | 'system'
						const msg = m.message as any;
						const id = m.uuid || `subagent-msg-${idx}`;
						let text = "";
						let thinking = "";
						const toolCalls: any[] = [];

						if (typeof msg === "string") {
							text = msg;
						} else if (msg && typeof msg === "object") {
							// Anthropic API message format: { role, content: [...blocks] }
							const content = Array.isArray(msg.content) ? msg.content : msg.content ? [msg.content] : [];
							for (const block of content) {
								if (!block || typeof block !== "object") continue;
								if (block.type === "text") text += `${block.text ?? ""}\n`;
								if (block.type === "thinking") thinking += `${block.thinking ?? ""}\n`;
								if (block.type === "tool_use") {
									toolCalls.push({
										toolUseId: block.id ?? `tool-${idx}`,
										tool: block.name ?? "tool",
										input: block.input ?? {},
										status: "completed",
									});
								}
								if (block.type === "tool_result") {
									// Find the matching tool call and attach output
									const matchId = block.tool_use_id;
									const existing = toolCalls.find((tc: any) => tc.toolUseId === matchId);
									const resultText = Array.isArray(block.content)
										? block.content
												.filter((c: any) => c?.type === "text")
												.map((c: any) => c.text)
												.join("\n")
										: typeof block.content === "string"
											? block.content
											: "";
									if (existing) {
										existing.output = resultText;
									}
								}
							}
						}

						return {
							id,
							role,
							text: text.trim(),
							createdAt: 0,
							...(thinking.trim() ? { thinking: thinking.trim() } : {}),
							...(toolCalls.length > 0 ? { toolCalls } : {}),
						};
					})
					.filter((m: TranscriptItem) => m.text || m.toolCalls?.length);

				reply({ type: "cc_subagent_messages", data: data as any, requestId: message.requestId as string });
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
