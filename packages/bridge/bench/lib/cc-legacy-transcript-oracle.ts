/**
 * The pre-optimisation transcript builder: whole file into one string, split, parse every line.
 * Kept so parity tests and the real-data benchmark can diff new against old.
 *
 * The small line parsers are imported from the extracted module because they were moved without a
 * behaviour change; only the read strategy differs here.
 */

import {
	extractFirstTextContent,
	isLikelyCommandEcho,
	isoToMs,
	safeParseJsonLine,
	type TranscriptContentBlock,
	toolResultToText,
	toolUseResultToDiff,
} from "../../src/connectors/claude-code/cc-transcript-parse";
import type { ClaudeCodeTranscriptMessage } from "../../src/types";

export async function legacyGetSessionMessages(
	filePath: string,
	limit?: number,
): Promise<ClaudeCodeTranscriptMessage[]> {
	try {
		const text = await Bun.file(filePath).text();
		const lines = text.split("\n").filter(Boolean);

		const messages: ClaudeCodeTranscriptMessage[] = [];
		const toolIndexById = new Map<string, { messageIndex: number; toolIndex: number }>();

		for (const line of lines) {
			const parsed = safeParseJsonLine(line);
			if (!parsed) continue;

			if (parsed.type !== "user" && parsed.type !== "assistant") continue;
			if (parsed.isMeta === true) continue;
			if (!parsed.message) continue;

			const role = parsed.message.role;
			const createdAt = isoToMs(parsed.timestamp);
			const id = parsed.uuid || `${parsed.type}-${createdAt}`;

			if (role === "user") {
				const maybeText = extractFirstTextContent(parsed.message.content);
				if (maybeText) {
					if (isLikelyCommandEcho(maybeText)) continue;
					messages.push({ id, role: "user", createdAt, text: maybeText });
					continue;
				}

				const content = parsed.message.content;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (!block || typeof block !== "object") continue;
						const trBlock = block as TranscriptContentBlock;
						if (trBlock.type !== "tool_result") continue;
						const toolUseId = trBlock.tool_use_id;
						if (!toolUseId) continue;

						const toolOutput = toolResultToText(trBlock.content);
						const toolUseResult = parsed.toolUseResult;

						const idx = toolIndexById.get(toolUseId);
						if (!idx) continue;
						const msg = messages[idx.messageIndex];
						if (!msg) continue;
						const tool = msg.toolCalls?.[idx.toolIndex];
						if (!tool) continue;

						const nextToolCalls = [...(msg.toolCalls ?? [])];
						nextToolCalls[idx.toolIndex] = {
							...tool,
							status: "completed" as const,
							output: toolOutput || tool.output,
							metadata: {
								...(tool.metadata ?? {}),
								...(toolUseResult ? { toolUseResult } : {}),
							},
						};

						let nextDiffs = msg.diffs ?? [];
						const diff = toolUseResultToDiff(toolUseResult);
						if (diff) {
							nextDiffs = [
								...nextDiffs,
								{
									file: diff.file,
									before: diff.before,
									after: diff.after,
									diff: diff.diff,
									additions: diff.additions,
									deletions: diff.deletions,
									partId: toolUseId,
								},
							];
						}

						messages[idx.messageIndex] = {
							...msg,
							text: msg.text ?? "",
							toolCalls: nextToolCalls,
							diffs: nextDiffs,
						};
					}
				}

				continue;
			}

			if (role === "assistant") {
				const content = parsed.message.content;
				const toolCalls: Array<{
					toolUseId: string;
					tool: string;
					input?: any;
					status: "running" | "completed" | "failed";
					output?: string;
					metadata?: Record<string, unknown>;
				}> = [];

				let thinking = "";
				let textOut = "";

				if (Array.isArray(content)) {
					for (const block of content) {
						if (!block || typeof block !== "object") continue;
						const b = block as TranscriptContentBlock;
						if (b.type === "thinking" && typeof b.thinking === "string") thinking += b.thinking;
						if (b.type === "text" && typeof b.text === "string") textOut += b.text;
						if (b.type === "tool_use") {
							const toolUseId = b.id;
							const tool = b.name;
							const input = b.input;
							if (toolUseId && tool) toolCalls.push({ toolUseId, tool, input, status: "running" });
						}
					}
				} else if (typeof content === "string") {
					textOut = content;
				}

				const msgIndex = messages.length;
				const builtToolCalls = toolCalls.length > 0 ? toolCalls : undefined;
				messages.push({
					id,
					role: "assistant",
					createdAt,
					text: textOut,
					...(thinking.trim().length > 0 ? { thinking } : {}),
					...(builtToolCalls ? { toolCalls: builtToolCalls } : {}),
					diffs: [],
				});

				if (builtToolCalls) {
					for (let i = 0; i < builtToolCalls.length; i++) {
						const tc = builtToolCalls[i];
						if (tc) toolIndexById.set(tc.toolUseId, { messageIndex: msgIndex, toolIndex: i });
					}
				}
			}
		}

		const filtered = messages.filter((m) => m.role !== "system");
		if (limit && limit > 0 && filtered.length > limit) {
			return filtered.slice(filtered.length - limit);
		}
		return filtered;
	} catch {
		return [];
	}
}
