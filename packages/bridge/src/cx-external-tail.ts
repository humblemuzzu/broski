/**
 * Codex external session tail.
 *
 * Monitors Codex session JSONL files on disk and emits streaming events
 * for sessions owned by external Codex TUI/CLI instances.
 *
 * Extracted from server.ts (~450 lines) to reduce file size.
 */
import { type FSWatcher, watch as fsWatch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { CodexStreamMessage } from "./types";

export type CxExternalTailContext = {
	emitCxStream: (threadId: string, streamMsg: CodexStreamMessage) => void;
	/** Broadcast a raw message to all sockets (used for external-user-message). */
	broadcastRaw?: (message: Record<string, unknown>) => void;
	safeString: (value: unknown) => string;
	logDebug: (msg: string) => void;
	DEBUG_RTS: boolean;
};

export async function resolveCodexExternalSessionFile(threadId: string): Promise<string | null> {
	const baseDir = resolve(homedir(), ".codex", "sessions");
	const id = threadId.trim();
	if (!id) return null;

	// Fast path: exact stem match
	const direct = resolve(baseDir, `${id}.jsonl`);
	try {
		const st = await stat(direct);
		if (st.isFile()) return direct;
	} catch {
		// ignore
	}

	// Common case: filenames include the thread/session id as a suffix.
	const pattern = `**/*${id}*.jsonl`;
	let best: { path: string; mtimeMs: number } | null = null;
	try {
		const glob = new Bun.Glob(pattern);
		for await (const rel of glob.scan({ cwd: baseDir, onlyFiles: true })) {
			const abs = resolve(baseDir, rel);
			const st = await stat(abs).catch(() => null);
			if (!st?.isFile()) continue;
			const mtimeMs = st.mtime.getTime();
			if (!best || mtimeMs > best.mtimeMs) best = { path: abs, mtimeMs };
		}
	} catch {
		// ignore
	}

	return best?.path ?? null;
}

export function startCodexExternalTail(threadId: string, ctx: CxExternalTailContext): { stop: () => void } {
	let stopped = false;
	let filePath: string | null = null;
	let fileHandle: any | null = null;
	let offset = 0;
	let buffer = "";
	let watcher: FSWatcher | null = null;
	let dirWatcher: FSWatcher | null = null;
	let pollTimer: Timer | null = null;
	let pumping = false;
	let turnInProgress = false;
	let lastIno = 0;
	let initialSyncDone = false; // Skip emitting events until first pump completes (builds baseline)
	const emittedItems = new Set<string>(); // Track emitted items to avoid duplicates

	const closeHandle = async () => {
		if (!fileHandle) return;
		try {
			await fileHandle.close();
		} catch {
			// ignore
		}
		fileHandle = null;
	};

	const ensureFile = async () => {
		if (filePath) return true;
		const resolved = await resolveCodexExternalSessionFile(threadId);
		if (!resolved) {
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(`[RTS] CX External: Could not resolve file for thread ${threadId}`);
			}
			return false;
		}
		if (ctx.DEBUG_RTS) {
			ctx.logDebug(`[RTS] CX External: Resolved file for thread ${threadId}: ${resolved}`);
		}
		filePath = resolved;
		try {
			const st = await stat(filePath);
			offset = Number(st.size ?? 0);
			lastIno = Number(st.ino ?? 0);
		} catch {
			offset = 0;
			lastIno = 0;
		}
		// Bootstrap baseline from existing records
		await bootstrapBaseline(resolved);
		return true;
	};

	const bootstrapBaseline = async (path: string) => {
		// Reads ALL existing records to build baseline state (emittedItems)
		// This prevents re-emitting historical events when the external tail starts.
		try {
			const st = await stat(path);
			const end = Number(st.size ?? 0);
			if (!Number.isFinite(end) || end <= 0) return;
			const maxBytes = 400_000;
			const start = Math.max(0, end - maxBytes);
			const fh = await open(path, "r");
			try {
				const len = end - start;
				const buf = Buffer.alloc(len);
				const res = await fh.read(buf, 0, len, start);
				const txt = buf.subarray(0, res.bytesRead).toString("utf-8");
				const lines = txt.split("\n").filter(Boolean);

				// Process ALL lines to build baseline (track emitted items)
				for (const line of lines) {
					let parsed: any;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}

					const outerType = parsed?.type as string | undefined;
					const payload = parsed?.payload ?? null;

					// Track response_item records for baseline
					if (outerType === "response_item") {
						const item = payload?.item ?? payload;
						const itemId = ctx.safeString(item?.id) || "";
						if (itemId) {
							emittedItems.add(itemId);
						}
					}
				}

				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CX Bootstrap: Built baseline for thread ${threadId}: ${emittedItems.size} items tracked`);
				}
			} finally {
				await fh.close().catch(() => {});
			}
		} catch {
			// ignore
		}
	};

	const emit = (method: string, params: Record<string, unknown>) => {
		// Only emit events AFTER initial sync is done
		if (!initialSyncDone) return;
		ctx.emitCxStream(threadId, {
			type: "notification",
			method,
			params: { threadId, ...params },
		});
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
					turnInProgress = false;
					emittedItems.clear();
				}
				return;
			}

			const size = Number(st.size ?? 0);
			const ino = Number(st.ino ?? 0);

			if (!Number.isFinite(size)) return;

			// Check for file rotation (inode changed)
			if (lastIno !== 0 && ino !== lastIno) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CX External: File rotated for thread ${threadId}`);
				}
				await closeHandle();
				offset = 0;
				buffer = "";
				turnInProgress = false;
				emittedItems.clear();
			}
			lastIno = ino;

			// Check for truncation
			if (size < offset) {
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CX External: File truncated for thread ${threadId}`);
				}
				offset = 0;
				buffer = "";
				turnInProgress = false;
				emittedItems.clear();
			}

			if (size === offset) return;

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

				const outerType = parsed?.type as string | undefined;
				const payload = parsed?.payload ?? null;

				// Handle event_msg records
				if (outerType === "event_msg") {
					const payloadType = payload?.type;

					if (payloadType === "user_message") {
						if (!turnInProgress) {
							turnInProgress = true;
							emit("turn/started", {});
							if (ctx.DEBUG_RTS) {
								ctx.logDebug(`[RTS] CX External: turn/started for thread ${threadId}`);
							}
						}
						// Emit user text so the phone shows the prompt typed on Mac
						if (initialSyncDone && ctx.broadcastRaw) {
							const userText = typeof payload?.text === "string" ? payload.text : "";
							if (userText) {
								ctx.broadcastRaw({
									type: "runtime_event",
									backend: "codex",
									data: {
										type: "backend_event",
										backend: "codex",
										kind: "external-user-message",
										timestampMs: Date.now(),
										sessionId: threadId,
										payload: { content: userText, timestamp: Date.now() },
									},
								});
							}
						}
						continue;
					}

					if (payloadType === "agent_reasoning" && typeof payload?.text === "string") {
						const delta = payload.text;
						if (delta) {
							emit("item/reasoning/textDelta", {
								itemId: `cx-ext-thinking-${threadId}`,
								delta,
							});
						}
						continue;
					}

					if (payloadType === "agent_message") {
						const text =
							typeof payload?.message === "string"
								? payload.message
								: typeof payload?.text === "string"
									? payload.text
									: "";
						if (text) {
							const ts = typeof parsed?.timestamp === "string" ? parsed.timestamp : `${Date.now()}`;
							const itemId = `cx-ext-msg-${ts.replace(/[^a-zA-Z0-9]/g, "_")}`;
							emit("item/agentMessage/delta", { itemId, delta: text });
							if (turnInProgress) {
								turnInProgress = false;
								emit("turn/completed", {});
								if (ctx.DEBUG_RTS) {
									ctx.logDebug(`[RTS] CX External: turn/completed for thread ${threadId}`);
								}
							}
						}
						continue;
					}

					// Handle turn_completed event
					if (payloadType === "turn_completed") {
						if (turnInProgress) {
							turnInProgress = false;
							emit("turn/completed", { usage: payload?.usage });
							if (ctx.DEBUG_RTS) {
								ctx.logDebug(`[RTS] CX External: turn/completed (explicit) for thread ${threadId}`);
							}
						}
						continue;
					}
				}

				// Handle response_item records (tool calls)
				if (outerType === "response_item") {
					const item = payload?.item ?? payload;
					const itemType = ctx.safeString(item?.type);
					const itemId = ctx.safeString(item?.id) || `cx-ext-item-${Date.now()}`;

					// Avoid duplicate emissions
					if (emittedItems.has(itemId)) continue;

					if (itemType === "function_call") {
						emittedItems.add(itemId);
						const name = ctx.safeString(item?.name);
						let args: any = {};
						try {
							args = typeof item?.arguments === "string" ? JSON.parse(item.arguments) : (item?.arguments ?? {});
						} catch {}

						emit("item/started", {
							item: {
								id: itemId,
								type: "commandExecution",
								command: args?.command || name,
								status: "running",
							},
						});

						if (ctx.DEBUG_RTS) {
							ctx.logDebug(`[RTS] CX External: item/started (function_call) ${name} for thread ${threadId}`);
						}
						continue;
					}

					if (itemType === "function_call_output") {
						const callId = ctx.safeString(item?.call_id);
						const output = ctx.safeString(item?.output);

						emit("item/completed", {
							item: {
								id: callId || itemId,
								type: "commandExecution",
								status: "completed",
								output,
							},
						});

						if (ctx.DEBUG_RTS) {
							ctx.logDebug(`[RTS] CX External: item/completed (function_call_output) for thread ${threadId}`);
						}
						continue;
					}

					// Handle file change items
					if (itemType === "file_change" || itemType === "fileChange") {
						emittedItems.add(itemId);
						const changes = Array.isArray(item?.changes) ? item.changes : [];

						emit("item/started", {
							item: {
								id: itemId,
								type: "fileChange",
								changes,
								status: "running",
							},
						});

						if (ctx.DEBUG_RTS) {
							ctx.logDebug(`[RTS] CX External: item/started (fileChange) for thread ${threadId}`);
						}
					}
				}
			}

			// Mark initial sync as done after first successful pump
			// This ensures we only emit NEW events from this point on
			if (!initialSyncDone) {
				initialSyncDone = true;
				if (ctx.DEBUG_RTS) {
					ctx.logDebug(`[RTS] CX External: Initial sync done for thread ${threadId}, will now emit events`);
				}
			}
		} catch (err) {
			if (ctx.DEBUG_RTS) {
				ctx.logDebug(
					`[RTS] CX External: Error in pump for thread ${threadId}: ${err instanceof Error ? err.stack : err}`,
				);
			}
			await closeHandle();
			filePath = null;
		} finally {
			pumping = false;
		}
	};

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
		ctx.logDebug(`[RTS] CX External: Started tailing thread ${threadId}`);
	}

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
				ctx.logDebug(`[RTS] CX External: Stopped tailing thread ${threadId}`);
			}
		},
	};
}
