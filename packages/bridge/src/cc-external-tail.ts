/**
 * Claude Code external session tail.
 *
 * Monitors CC session JSONL files on disk and emits streaming events
 * for sessions owned by external Claude CLI/TUI instances.
 * 
 * Extracted from server.ts (675 lines) to reduce file size.
 */
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { ClaudeCodeStreamMessage } from "./types";

export type CcExternalTailContext = {
	claudeCode: {
		resolveSessionFilePath: (sessionId: string) => Promise<string | null>;
	};
	emitCcStream: (sessionId: string, streamMsg: ClaudeCodeStreamMessage) => void;
	safeString: (value: unknown) => string;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

export function startClaudeCodeExternalTail(
	sessionId: string,
	ctx: CcExternalTailContext,
): { stop: () => void } {
	let stopped = false;
	let filePath: string | null = null;
	let fileHandle: any | null = null;
	let offset = 0;
	let buffer = "";
	let watcher: FSWatcher | null = null;
	let dirWatcher: FSWatcher | null = null;
	let pollTimer: Timer | null = null;
	let pumping = false;
	let lastMtimeMs = 0;
	let lastIno = 0;
	let initialSyncDone = false; // Skip emitting events until first pump completes (builds baseline)
	const lastTextByMessageId = new Map<string, string>();
	const lastThinkingByMessageId = new Map<string, string>();
	const emittedToolCalls = new Set<string>(); // Track emitted tool calls to avoid duplicates

	// Type for content blocks parsed from CC session JSONL files
	interface CcContentBlock {
		type: string;
		text?: string;
		thinking?: string;
		id?: string;
		name?: string;
		input?: unknown;
		content?: unknown;
		tool_use_id?: string;
		is_error?: boolean;
	}
	const isBlock = (b: unknown): b is CcContentBlock =>
		typeof b === "object" && b !== null && "type" in b && typeof (b as CcContentBlock).type === "string";

	const extractText = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		const parts: string[] = [];
		for (const block of content) {
			if (!isBlock(block)) continue;
			if (block.type === "text" && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
		return parts.join("");
	};

	const extractThinking = (content: unknown): string => {
		if (!Array.isArray(content)) return "";
		const parts: string[] = [];
		for (const block of content) {
			if (!isBlock(block)) continue;
			if (block.type === "thinking" && typeof block.thinking === "string") {
				parts.push(block.thinking);
			}
		}
		return parts.join("");
	};

	type ToolUseBlock = {
		id: string;
		name: string;
		input: unknown;
	};

	const extractToolUseBlocks = (content: unknown): ToolUseBlock[] => {
		if (!Array.isArray(content)) return [];
		const tools: ToolUseBlock[] = [];
		for (const block of content) {
			if (!isBlock(block)) continue;
			if (block.type === "tool_use") {
				tools.push({
					id: ctx.safeString(block.id),
					name: ctx.safeString(block.name),
					input: block.input,
				});
			}
		}
		return tools;
	};

	type ToolResultBlock = {
		toolUseId: string;
		content: string;
		isError?: boolean;
	};

	const extractToolResults = (content: unknown): ToolResultBlock[] => {
		if (!Array.isArray(content)) return [];
		const results: ToolResultBlock[] = [];
		for (const block of content) {
			if (!isBlock(block)) continue;
			if (block.type === "tool_result") {
				let resultContent = "";
				const c = block.content;
				if (typeof c === "string") {
					resultContent = c;
				} else if (Array.isArray(c)) {
					for (const part of c) {
						if (isBlock(part) && part.type === "text" && typeof part.text === "string") {
							resultContent += part.text;
						}
					}
				}
				results.push({
					toolUseId: ctx.safeString(block.tool_use_id),
					content: resultContent,
					isError: block.is_error === true,
				});
			}
		}
		return results;
	};

	const bootstrapBaseline = async (path: string) => {
		// Reads ALL existing records to build baseline state for text, thinking, and tool calls.
		// This prevents re-emitting historical events when the external tail starts.
		try {
			const st = await stat(path);
			const end = Number(st.size ?? 0);
			if (!Number.isFinite(end) || end <= 0) return;
			const maxBytes = 400_000; // Increased to capture more history
			const start = Math.max(0, end - maxBytes);
			const fh = await open(path, "r");
			try {
				const len = end - start;
				const buf = Buffer.alloc(len);
				const res = await fh.read(buf, 0, len, start);
				const txt = buf.subarray(0, res.bytesRead).toString("utf-8");
				const lines = txt.split("\n").filter(Boolean);

				// Process ALL lines (not just the last one) to build complete baseline
				for (const line of lines) {
					let parsed: any;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}

					// Process assistant records for text, thinking, and tool_use
					if (parsed?.type === "assistant" && parsed?.isMeta !== true) {
						const msgId =
							typeof parsed?.uuid === "string"
								? parsed.uuid
								: typeof parsed?.message?.id === "string"
									? parsed.message.id
									: "";
						if (!msgId) continue;

						const content = parsed?.message?.content;

						// Track text baseline
						const text = extractText(content);
						if (text) {
							lastTextByMessageId.set(msgId, text);
						}

						// Track thinking baseline
						const thinking = extractThinking(content);
						if (thinking) {
							lastThinkingByMessageId.set(msgId, thinking);
						}

						// Track emitted tool calls baseline
						const toolUseBlocks = extractToolUseBlocks(content);
						for (const tool of toolUseBlocks) {
							if (tool.id) {
								emittedToolCalls.add(`${msgId}:${tool.id}`);
							}
						}
					}
				}

				if (ctx.DEBUG_RTS) {
					ctx.logDebug(
						`[RTS] CC Bootstrap: Built baseline for session ${sessionId}: ` +
							`${lastTextByMessageId.size} texts, ${lastThinkingByMessageId.size} thinking, ${emittedToolCalls.size} tool calls`,
					);
				}
			} finally {
				await fh.close().catch(() => {});
			}
		} catch {
			// ignore
		}
	};

	// Shape of usage from Anthropic API responses
	interface AnthropicUsage {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
		reasoning_tokens?: number;
		reasoning_output_tokens?: number;
	}

	const extractUsage = (parsed: {
		message?: { usage?: AnthropicUsage };
	}): {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		reasoningTokens?: number;
	} => {
		const usage = parsed?.message?.usage;
		if (!usage || typeof usage !== "object") return {};
		const inputTokens = Number(usage.input_tokens ?? NaN);
		const outputTokens = Number(usage.output_tokens ?? NaN);
		const cacheReadTokens = Number(usage.cache_read_input_tokens ?? NaN);
		const cacheWriteTokens = Number(usage.cache_creation_input_tokens ?? NaN);
		const reasoningTokens = Number(usage.reasoning_tokens ?? usage.reasoning_output_tokens ?? NaN);
		return {
			...(Number.isFinite(inputTokens) ? { inputTokens } : {}),
			...(Number.isFinite(outputTokens) ? { outputTokens } : {}),
			...(Number.isFinite(cacheReadTokens) ? { cacheReadTokens } : {}),
			...(Number.isFinite(cacheWriteTokens) ? { cacheWriteTokens } : {}),
			...(Number.isFinite(reasoningTokens) ? { reasoningTokens } : {}),
		};
	};

	const isCompletedAssistantRecord = (parsed: any): boolean => {
		if (parsed?.type !== "assistant") return false;
		const msg = parsed?.message;
		if (!msg || typeof msg !== "object") return false;
		// Claude Code persists final assistant blocks with usage/stop_reason filled.
		if (msg.usage && typeof msg.usage === "object") return true;
		if (msg.stop_reason != null) return true;
		return false;
	};

	const applyAssistantTextUpdate = (msgId: string, text: string, parsed?: any) => {
		if (!msgId) return;
		const prev = lastTextByMessageId.get(msgId) ?? "";

		// Always update baseline state, even before initialSyncDone
		if (text && text !== prev) {
			lastTextByMessageId.set(msgId, text);
		}

		// Only emit events AFTER initial sync is done
		if (!initialSyncDone) return;

		if (!text || text === prev) {
			// Still send completion if we learned this record is complete (e.g., usage filled later).
			if (parsed && isCompletedAssistantRecord(parsed)) {
				ctx.emitCcStream(sessionId, {
					type: "token-usage",
					usage: extractUsage(parsed),
					messageId: msgId,
				});
			}
			return;
		}

		if (prev && text.startsWith(prev)) {
			const delta = text.slice(prev.length);
			if (delta) {
				ctx.emitCcStream(sessionId, {
					type: "assistant-message-delta",
					content: delta,
					messageId: msgId,
				});
			}
		} else {
			// Non-append update (file rewrites or truncated context): replace with full text.
			ctx.emitCcStream(sessionId, {
				type: "assistant-message",
				content: text,
				messageId: msgId,
			});
		}

		if (parsed && isCompletedAssistantRecord(parsed)) {
			ctx.emitCcStream(sessionId, {
				type: "token-usage",
				usage: extractUsage(parsed),
				messageId: msgId,
			});
		}
	};

	const applyThinkingUpdate = (msgId: string, thinking: string) => {
		if (!msgId || !thinking) return;
		const prev = lastThinkingByMessageId.get(msgId) ?? "";

		// Always update baseline state, even before initialSyncDone
		if (thinking !== prev) {
			lastThinkingByMessageId.set(msgId, thinking);
		}

		// Only emit events AFTER initial sync is done
		if (!initialSyncDone) return;
		if (thinking === prev) return;

		if (prev && thinking.startsWith(prev)) {
			const delta = thinking.slice(prev.length);
			if (delta) {
				ctx.emitCcStream(sessionId, {
					type: "thinking-delta",
					content: delta,
					messageId: msgId,
				});
			}
		} else {
			// Full thinking content (for initial or non-delta cases)
			ctx.emitCcStream(sessionId, {
				type: "thinking-delta",
				content: thinking,
				messageId: msgId,
			});
		}
	};

	const processToolUseBlocks = (msgId: string, toolUseBlocks: ToolUseBlock[]) => {
		for (const tool of toolUseBlocks) {
			if (!tool.id) continue;
			// Avoid duplicate emissions
			const key = `${msgId}:${tool.id}`;
			if (emittedToolCalls.has(key)) continue;
			emittedToolCalls.add(key);

			// Only emit events AFTER initial sync is done
			if (!initialSyncDone) continue;

			ctx.emitCcStream(sessionId, {
				type: "tool-call",
				tool: tool.name,
				input: tool.input,
				toolUseId: tool.id,
				status: "running",
				messageId: msgId,
			});

			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CC External: Emitted tool-call ${tool.name} (${tool.id}) for session ${sessionId}`);
			}
		}
	};

	const processToolResults = (toolResults: ToolResultBlock[]) => {
		// Only emit events AFTER initial sync is done
		if (!initialSyncDone) return;

		for (const result of toolResults) {
			if (!result.toolUseId) continue;

			ctx.emitCcStream(sessionId, {
				type: "tool-result",
				toolUseId: result.toolUseId,
				result: result.content,
				toolUseResult: result.isError ? { error: result.content } : { output: result.content },
			});

			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CC External: Emitted tool-result for ${result.toolUseId} for session ${sessionId}`);
			}
		}
	};

	const readLatestAssistantFromTail = async (
		path: string,
	): Promise<{ msgId: string; text: string; parsed: any } | null> => {
		try {
			const st = await stat(path);
			const end = Number(st.size ?? 0);
			if (!Number.isFinite(end) || end <= 0) return null;
			const maxBytes = 400_000;
			const start = Math.max(0, end - maxBytes);
			const fh = await open(path, "r");
			try {
				const len = end - start;
				const buf = Buffer.alloc(len);
				const res = await fh.read(buf, 0, len, start);
				const txt = buf.subarray(0, res.bytesRead).toString("utf-8");
				const lines = txt.split("\n").filter(Boolean);
				for (let i = lines.length - 1; i >= 0; i--) {
					const line = lines[i]!.trim();
					if (!line) continue;
					let parsed: any;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}
					if (parsed?.type !== "assistant" || parsed?.isMeta === true) continue;
					const msgId =
						typeof parsed?.uuid === "string"
							? parsed.uuid
							: typeof parsed?.message?.id === "string"
								? parsed.message.id
								: "";
					if (!msgId) continue;
					const text = extractText(parsed?.message?.content);
					return { msgId, text, parsed };
				}
			} finally {
				await fh.close().catch(() => {});
			}
		} catch {
			// ignore
		}
		return null;
	};

	const ensureFile = async () => {
		if (filePath) return true;
		const resolved = await ctx.claudeCode.resolveSessionFilePath(sessionId);
		if (!resolved) {
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CC External: Could not resolve file for session ${sessionId}`);
			}
			return false;
		}
		if (ctx.DEBUG_RTS) {
			ctx.logDebug(`[RTS] CC External: Resolved file for session ${sessionId}: ${resolved}`);
		}
		filePath = resolved;
		try {
			const st = await stat(filePath);
			offset = Number(st.size ?? 0);
			lastMtimeMs = st.mtime.getTime();
		} catch {
			offset = 0;
		}
		await bootstrapBaseline(filePath);
		return true;
	};

	const closeHandle = async () => {
		if (!fileHandle) return;
		try {
			await fileHandle.close();
		} catch {
			// ignore
		}
		fileHandle = null;
	};

	const pump = async () => {
		if (stopped || pumping) return;
		pumping = true;
		try {
			const ok = await ensureFile();
			if (!ok || !filePath) return;

			const st = await stat(filePath).catch(() => null);
			if (!st) {
				// File doesn't exist - reset
				if (offset > 0) {
					offset = 0;
					buffer = "";
					lastTextByMessageId.clear();
					lastThinkingByMessageId.clear();
					emittedToolCalls.clear();
				}
				return;
			}

			const size = Number(st.size ?? 0);
			const mtimeMs = st.mtime?.getTime?.() ?? 0;
			const ino = Number(st.ino ?? 0);

			if (!Number.isFinite(size)) return;

			// Check for file rotation (inode changed)
			if (lastIno !== 0 && ino !== lastIno) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CC External: File rotated for session ${sessionId}`);
				}
				await closeHandle();
				offset = 0;
				buffer = "";
				lastTextByMessageId.clear();
				lastThinkingByMessageId.clear();
				emittedToolCalls.clear();
			}
			lastIno = ino;

			// Check for truncation
			if (size < offset) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CC External: File truncated for session ${sessionId}`);
				}
				offset = 0;
				buffer = "";
				lastTextByMessageId.clear();
				lastThinkingByMessageId.clear();
				emittedToolCalls.clear();
			}

			if (size === offset) {
				// Some Claude Code versions update transcripts in-place without appending bytes.
				// If mtime changed, re-read tail and diff the latest assistant message.
				if (mtimeMs > lastMtimeMs && filePath) {
					const latest = await readLatestAssistantFromTail(filePath);
					if (latest) {
						applyAssistantTextUpdate(latest.msgId, latest.text, latest.parsed);
					}
				}
				lastMtimeMs = Math.max(lastMtimeMs, mtimeMs);
				return;
			}
			lastMtimeMs = Math.max(lastMtimeMs, mtimeMs);

			if (!fileHandle) {
				fileHandle = await open(filePath, "r");
			}

			const toRead = size - offset;
			const buf = Buffer.alloc(toRead);
			const res = await fileHandle.read(buf, 0, toRead, offset);
			offset += res.bytesRead;

			const chunk = buf.subarray(0, res.bytesRead).toString("utf-8");
			if (!chunk) return;
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let parsed: any;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}

				const recordType = parsed?.type;

				// Process assistant messages (text, thinking, tool_use)
				if (recordType === "assistant" && parsed?.isMeta !== true) {
					const msgId =
						typeof parsed?.uuid === "string"
							? parsed.uuid
							: typeof parsed?.message?.id === "string"
								? parsed.message.id
								: "";
					if (!msgId) continue;

					const content = parsed?.message?.content;

					// Extract and emit text
					const text = extractText(content);
					applyAssistantTextUpdate(msgId, text, parsed);

					// Extract and emit thinking
					const thinking = extractThinking(content);
					if (thinking) {
						applyThinkingUpdate(msgId, thinking);
					}

					// Extract and emit tool_use blocks
					const toolUseBlocks = extractToolUseBlocks(content);
					if (toolUseBlocks.length > 0) {
						processToolUseBlocks(msgId, toolUseBlocks);
					}
				}

				// Process user messages (for tool_result AND user text)
				if (recordType === "user") {
					const content = parsed?.message?.content;

					// Extract and emit tool results (processToolResults already has initialSyncDone check)
					const toolResults = extractToolResults(content);
					if (toolResults.length > 0) {
						processToolResults(toolResults);
					}
				}
			}

			// Mark initial sync as done after first successful pump
			// This ensures we only emit NEW events from this point on
			if (!initialSyncDone) {
				initialSyncDone = true;
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CC External: Initial sync done for session ${sessionId}, will now emit events`);
				}
			}
		} catch (err) {
			// If the file was rotated/deleted, reset and retry.
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CC External: Error in pump for session ${sessionId}: ${err}`);
			}
			await closeHandle();
			filePath = null;
		} finally {
			pumping = false;
		}
	};

	const start = () => {
		// Poll at 100ms for real-time sync (5x faster than previous 500ms)
		pollTimer = setInterval(() => {
			void pump();
		}, 100);

		void ensureFile().then((ok) => {
			if (!ok || !filePath || stopped) return;

			// Watch the file itself
			try {
				watcher = fsWatch(filePath, { persistent: false }, () => {
					void pump();
				});
				watcher.on("error", () => {
					if (watcher) {
						try {
							watcher.close();
						} catch {}
						watcher = null;
					}
				});
			} catch {
				// ignore (polling will handle)
			}

			// Also watch parent directory for more reliable notifications
			try {
				const parentDir = dirname(filePath);
				dirWatcher = fsWatch(parentDir, { persistent: false }, (_, filename) => {
					if (filename && filePath?.endsWith(filename)) {
						void pump();
					}
				});
				dirWatcher.on("error", () => {
					if (dirWatcher) {
						try {
							dirWatcher.close();
						} catch {}
						dirWatcher = null;
					}
				});
			} catch {
				// ignore (polling will handle)
			}
		});

		if (ctx.DEBUG_RTS) {
			ctx.logDebug(`[RTS] CC External: Started tailing session ${sessionId}`);
		}
	};

	start();

	return {
		stop: () => {
			stopped = true;
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			if (watcher) {
				try {
					watcher.close();
				} catch {}
				watcher = null;
			}
			if (dirWatcher) {
				try {
					dirWatcher.close();
				} catch {}
				dirWatcher = null;
			}
			void closeHandle();

			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CC External: Stopped tailing session ${sessionId}`);
			}
		},
	};
	}
