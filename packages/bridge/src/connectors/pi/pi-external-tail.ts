/**
 * Pi external session tail.
 *
 * Watches a Pi session JSONL file on disk and emits streaming events
 * for sessions running in external Pi CLI/TUI instances (i.e. not
 * started by the bridge).
 *
 * Pi writes complete JSONL lines via appendFileSync — each line is a
 * finished message, not a streaming token. The tail detects new lines
 * and emits the corresponding PiStreamMessage events.
 *
 * Event lifecycle per new assistant message:
 *   agent-start → text-delta (full text) → thinking-delta (if any) →
 *   tool-call-start/args-done (for each tool) → message-done → agent-end
 */

import { type FSWatcher, watch as fsWatch } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { PiStreamMessage } from "../../types/pi";

export type PiExternalTailContext = {
	emitPiStream: (msg: PiStreamMessage) => void;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

export function startPiExternalTail(sessionFile: string, ctx: PiExternalTailContext): { stop: () => void } {
	let stopped = false;
	let offset = 0;
	let buffer = "";
	let watcher: FSWatcher | null = null;
	let dirWatcher: FSWatcher | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pumping = false;
	let lastIno = 0;
	let initialSyncDone = false;
	const seenMessageIds = new Set<string>();

	// Track whether the agent is currently "started" so we bracket events
	// correctly with agent-start/agent-end.
	let agentActive = false;

	const pump = async () => {
		if (pumping || stopped) return;
		pumping = true;
		try {
			const st = await stat(sessionFile).catch(() => null);
			if (!st) {
				pumping = false;
				return;
			}

			const currentIno = Number(st.ino ?? 0);
			if (lastIno && currentIno !== lastIno) {
				// File rotated (new session) — reset
				if (ctx.DEBUG_RTS) ctx.logDebug(`[Pi tail] File rotated, resetting`);
				offset = 0;
				buffer = "";
				seenMessageIds.clear();
				initialSyncDone = false;
				agentActive = false;
			}
			lastIno = currentIno;

			const fileSize = Number(st.size ?? 0);
			if (fileSize < offset) {
				// File truncated — reset
				offset = 0;
				buffer = "";
				seenMessageIds.clear();
				initialSyncDone = false;
				agentActive = false;
			}
			if (offset >= fileSize) {
				// Caught up to end of file — any new content from now on is live.
				if (!initialSyncDone) {
					initialSyncDone = true;
					console.log(`[Pi tail] Initial sync done, ${seenMessageIds.size} baseline messages`);
				}
				pumping = false;
				return;
			}

			const fh = await open(sessionFile, "r").catch(() => null);
			if (!fh) {
				pumping = false;
				return;
			}

			try {
				const bytesToRead = Math.min(131072, fileSize - offset);
				const buf = Buffer.alloc(bytesToRead);
				const { bytesRead } = await fh.read(buf, 0, bytesToRead, offset);
				offset += bytesRead;

				buffer += buf.subarray(0, bytesRead).toString("utf-8");
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						processEntry(JSON.parse(line));
					} catch {
						// skip malformed lines
					}
				}

				// Check if we've caught up after this read
				if (!initialSyncDone && offset >= fileSize) {
					initialSyncDone = true;
					console.log(`[Pi tail] Initial sync done, ${seenMessageIds.size} baseline messages`);
				}
			} finally {
				await fh.close().catch(() => {});
			}
		} catch (e) {
			if (ctx.DEBUG_RTS) ctx.logDebug(`[Pi tail] Pump error: ${e}`);
		} finally {
			pumping = false;
		}
	};

	const processEntry = (entry: any) => {
		// Only process message entries
		if (entry?.type !== "message") return;

		const msgId = entry.id as string;
		if (!msgId || seenMessageIds.has(msgId)) return;
		seenMessageIds.add(msgId);

		// During initial sync, just collect IDs — don't emit events
		if (!initialSyncDone) return;

		const msg = entry.message;
		if (!msg || typeof msg !== "object") return;
		const role = msg.role as string;
		if (!role) return;
		console.log(`[Pi tail] Processing new entry: role=${role}, msgId=${msgId}`);

		if (role === "user") {
			// User typed a prompt in the terminal — emit it so the phone shows it
			const userText =
				typeof msg.content === "string"
					? msg.content
					: Array.isArray(msg.content)
						? msg.content
								.filter((b: any) => b?.type === "text")
								.map((b: any) => b.text ?? "")
								.join("")
						: "";
			if (userText) {
				ctx.emitPiStream({
					type: "external-user-message",
					content: userText,
					timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
				});
			}
			// Agent should be starting
			if (!agentActive) {
				agentActive = true;
				ctx.emitPiStream({ type: "agent-start" });
			}
			return;
		}

		if (role === "assistant") {
			// Assistant completed a message — emit all content
			if (!agentActive) {
				agentActive = true;
				ctx.emitPiStream({ type: "agent-start" });
			}

			const content = msg.content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (!block || typeof block !== "object") continue;
					if (block.type === "text" && typeof block.text === "string" && block.text) {
						ctx.emitPiStream({ type: "text-delta", content: block.text });
					} else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
						ctx.emitPiStream({ type: "thinking-delta", content: block.thinking });
					} else if (block.type === "toolCall" && block.id) {
						ctx.emitPiStream({
							type: "tool-exec-start",
							toolCallId: String(block.id),
							toolName: String(block.name ?? "unknown"),
							args: block.arguments ?? {},
						});
					}
				}
			}

			// If the message has usage/stopReason, this is a terminal message
			const hasUsage = msg.usage && typeof msg.usage === "object";
			const hasStopReason = typeof msg.stopReason === "string";
			if (hasUsage || hasStopReason) {
				// Agent finished this turn — emit agent-end with the messages
				// We map this as a complete agent-end to update the phone's session view
				ctx.emitPiStream({
					type: "agent-end",
					messages: [msg],
				});
				agentActive = false;
			}
			return;
		}

		if (role === "toolResult") {
			// Tool finished — emit tool-exec-end
			const resultText = extractResultText(msg.content);
			ctx.emitPiStream({
				type: "tool-exec-end",
				toolCallId: String(msg.toolCallId ?? ""),
				toolName: String(msg.toolName ?? "unknown"),
				result: resultText,
				details: msg.details,
				isError: msg.isError === true,
			});
			return;
		}

		// bashExecution, custom, branchSummary, compactionSummary — ignore for streaming
	};

	// Start watcher (graceful if file doesn't exist yet)
	try {
		watcher = fsWatch(sessionFile, { persistent: false }, () => {
			if (!stopped) pump().catch(() => {});
		});
		watcher.on("error", () => {
			// File might not exist yet — poll will handle it
		});
	} catch {
		// fs.watch can throw on some platforms
	}

	// Also watch directory for file recreation
	try {
		const { dirname } = require("node:path");
		const dir = dirname(sessionFile);
		dirWatcher = fsWatch(dir, { persistent: false }, () => {
			if (!stopped) pump().catch(() => {});
		});
		dirWatcher.on("error", () => {});
	} catch {
		// ignore
	}

	// Polling fallback — 150ms when active, covers cases where fs.watch misses
	const schedulePoll = () => {
		if (stopped) return;
		pollTimer = setTimeout(() => {
			pump()
				.catch(() => {})
				.finally(schedulePoll);
		}, 150);
	};

	// Initial pump + start polling
	pump()
		.catch(() => {})
		.finally(schedulePoll);

	return {
		stop: () => {
			stopped = true;
			if (pollTimer) clearTimeout(pollTimer);
			if (watcher) {
				try {
					watcher.close();
				} catch {}
			}
			if (dirWatcher) {
				try {
					dirWatcher.close();
				} catch {}
			}
			watcher = null;
			dirWatcher = null;
		},
	};
}

function extractResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	for (const block of content) {
		if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
			return block.text;
		}
	}
	return "";
}
