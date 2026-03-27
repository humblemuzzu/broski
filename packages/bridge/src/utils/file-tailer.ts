/**
 * Shared JSONL file-tailer used by Claude Code and Codex external tail implementations.
 *
 * Encapsulates: file handle lifecycle, byte-offset tracking with inode rotation / truncation
 * detection, incremental line splitting with partial-line buffering, fs.watch + poll-interval
 * dual notification, and an initialSyncDone flag that callers use to skip emitting historical
 * events on first pump.
 *
 * Agent-specific behaviour is injected via callbacks (resolveFilePath, processRecord, etc.).
 *
 * ## Migration plan (future step)
 *
 * `startClaudeCodeExternalTail` in server.ts (~670 lines) can be refactored to:
 * ```ts
 * const tailer = new FileTailer({
 *   label: `CC External ${sessionId}`,
 *   resolveFilePath: () => claudeCode.resolveSessionFilePath(sessionId),
 *   bootstrapBaseline: (fp) => bootstrapCcBaseline(fp, trackingState),
 *   processRecord: (rec) => processCcRecord(rec, tailer, trackingState, emitCcStream),
 *   onReset: () => { trackingState.clear(); },
 *   onUnchangedSize: (fp) => ccMtimeReread(fp, trackingState, emitCcStream),
 *   debug: DEBUG_RTS, logDebug,
 * });
 * ```
 * CC-specific helpers (extractText, extractThinking, extractToolUse*, applyAssistantTextUpdate,
 * bootstrapBaseline, readLatestAssistantFromTail) move to a new file:
 *   `packages/bridge/src/handlers/cc_external_tail.ts`
 *
 * `startCodexExternalTail` in server.ts (~420 lines) can be refactored to:
 * ```ts
 * const tailer = new FileTailer({
 *   label: `CX External ${threadId}`,
 *   resolveFilePath: () => resolveCodexExternalSessionFile(threadId),
 *   bootstrapBaseline: (fp) => bootstrapCxBaseline(fp, emittedItems),
 *   processRecord: (rec) => processCxRecord(rec, tailer, emittedItems, emitCxStream),
 *   onReset: () => { emittedItems.clear(); turnInProgress = false; },
 *   debug: DEBUG_RTS, logDebug,
 * });
 * ```
 * CX-specific record processing moves to:
 *   `packages/bridge/src/handlers/cx_external_tail.ts`
 *
 * Note: `startOpenCodeExternalTail` is NOT a file tailer — it polls an API.
 * It does not share this infrastructure and should not be refactored to use FileTailer.
 */

import { type FSWatcher, watch as fsWatch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname } from "node:path";

// ── Public interface ────────────────────────────────────────────────────────

export interface FileTailerOptions {
	/** Human-readable label for debug logging (e.g. "CC External", "CX External"). */
	label: string;

	/** Resolve the absolute path to the JSONL file. Called once; result is cached. */
	resolveFilePath: () => Promise<string | null>;

	/**
	 * Called for every complete JSON record parsed from a newly-appended line.
	 * The caller decides whether to emit events (check `tailer.initialSyncDone`).
	 */
	processRecord: (parsed: unknown) => void;

	/**
	 * Called once after the file path is resolved, before the first pump.
	 * Use this to read existing file content and build baseline tracking state
	 * so that the first pump doesn't re-emit historical records.
	 */
	bootstrapBaseline?: (filePath: string) => Promise<void>;

	/**
	 * Called when file rotation (inode change) or truncation is detected.
	 * The caller should clear any tracking state (seen IDs, text baselines, etc.).
	 */
	onReset?: () => void;

	/**
	 * Called when a pump detects no new bytes (size === offset) but the file may have
	 * been updated in-place.  CC uses this for mtime-based re-reads of the latest
	 * assistant record.  Optional — most callers don't need this.
	 */
	onUnchangedSize?: (filePath: string) => Promise<void>;

	/** Poll interval in milliseconds. Default: 100. */
	pollIntervalMs?: number;

	/** Debug logging function.  Called only when `debug` is true. */
	logDebug?: (msg: string) => void;

	/** Enable verbose debug logging via `logDebug`. Default: false. */
	debug?: boolean;
}

// ── Implementation ──────────────────────────────────────────────────────────

export class FileTailer {
	/** True after the first successful pump completes. Callers check this in processRecord. */
	initialSyncDone = false;

	private stopped = false;
	private filePath: string | null = null;
	private fileHandle: Awaited<ReturnType<typeof open>> | null = null;
	private offset = 0;
	private buffer = "";
	private lastIno = 0;
	private pumping = false;

	private watcher: FSWatcher | null = null;
	private dirWatcher: FSWatcher | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	private readonly opts: FileTailerOptions;

	constructor(opts: FileTailerOptions) {
		this.opts = opts;
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	/** Begin tailing.  Sets up polling + fs watchers. */
	start(): void {
		const interval = this.opts.pollIntervalMs ?? 100;
		this.pollTimer = setInterval(() => {
			void this.pump();
		}, interval);

		void this.ensureFile().then((ok) => {
			if (!ok || !this.filePath || this.stopped) return;

			// Watch the file itself
			try {
				this.watcher = fsWatch(this.filePath, { persistent: false }, () => {
					void this.pump();
				});
				this.watcher.on("error", () => {
					if (this.watcher) {
						try {
							this.watcher.close();
						} catch {
							/* ignore */
						}
						this.watcher = null;
					}
				});
			} catch {
				/* ignore — polling will handle */
			}

			// Watch parent directory for more reliable notifications
			try {
				const parentDir = dirname(this.filePath);
				const fp = this.filePath;
				this.dirWatcher = fsWatch(parentDir, { persistent: false }, (_, filename) => {
					if (filename && fp.endsWith(filename)) {
						void this.pump();
					}
				});
				this.dirWatcher.on("error", () => {
					if (this.dirWatcher) {
						try {
							this.dirWatcher.close();
						} catch {
							/* ignore */
						}
						this.dirWatcher = null;
					}
				});
			} catch {
				/* ignore — polling will handle */
			}
		});

		this.log(`Started tailing`);
	}

	/** Stop tailing.  Cleans up timers, watchers, and file handles. */
	stop(): void {
		this.stopped = true;
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.watcher) {
			try {
				this.watcher.close();
			} catch {
				/* ignore */
			}
			this.watcher = null;
		}
		if (this.dirWatcher) {
			try {
				this.dirWatcher.close();
			} catch {
				/* ignore */
			}
			this.dirWatcher = null;
		}
		void this.closeHandle();
		this.log(`Stopped tailing`);
	}

	// ── Internals ──────────────────────────────────────────────────────────

	private log(msg: string): void {
		if (this.opts.debug && this.opts.logDebug) {
			this.opts.logDebug(`[RTS] ${this.opts.label}: ${msg}`);
		}
	}

	private async closeHandle(): Promise<void> {
		if (!this.fileHandle) return;
		try {
			await this.fileHandle.close();
		} catch {
			/* ignore */
		}
		this.fileHandle = null;
	}

	private async ensureFile(): Promise<boolean> {
		if (this.filePath) return true;
		const resolved = await this.opts.resolveFilePath();
		if (!resolved) {
			this.log(`Could not resolve file`);
			return false;
		}
		this.log(`Resolved file: ${resolved}`);
		this.filePath = resolved;

		try {
			const st = await stat(this.filePath);
			this.offset = Number(st.size ?? 0);
			this.lastIno = Number(st.ino ?? 0);
		} catch {
			this.offset = 0;
			this.lastIno = 0;
		}

		if (this.opts.bootstrapBaseline) {
			await this.opts.bootstrapBaseline(resolved);
		}
		return true;
	}

	private async pump(): Promise<void> {
		if (this.stopped || this.pumping) return;
		this.pumping = true;
		try {
			const ok = await this.ensureFile();
			if (!ok || !this.filePath) return;

			const st = await stat(this.filePath).catch(() => null);
			if (!st) {
				// File gone — reset
				if (this.offset > 0) {
					this.offset = 0;
					this.buffer = "";
					this.opts.onReset?.();
				}
				return;
			}

			const size = Number(st.size ?? 0);
			const ino = Number(st.ino ?? 0);
			if (!Number.isFinite(size)) return;

			// File rotation (inode changed)
			if (this.lastIno !== 0 && ino !== this.lastIno) {
				this.log(`File rotated`);
				await this.closeHandle();
				this.offset = 0;
				this.buffer = "";
				this.opts.onReset?.();
			}
			this.lastIno = ino;

			// Truncation
			if (size < this.offset) {
				this.log(`File truncated`);
				this.offset = 0;
				this.buffer = "";
				this.opts.onReset?.();
			}

			// No new bytes
			if (size === this.offset) {
				// Bootstrap already captured existing state — mark sync done even without new data
				if (!this.initialSyncDone) {
					this.initialSyncDone = true;
					this.log(`Initial sync done (no new data), will now emit events`);
				}
				if (this.opts.onUnchangedSize && this.filePath) {
					await this.opts.onUnchangedSize(this.filePath);
				}
				return;
			}

			// Read new bytes
			if (!this.fileHandle) {
				this.fileHandle = await open(this.filePath, "r");
			}

			const toRead = size - this.offset;
			const buf = Buffer.alloc(toRead);
			const res = await this.fileHandle.read(buf, 0, toRead, this.offset);
			this.offset += res.bytesRead;

			const chunk = buf.subarray(0, res.bytesRead).toString("utf-8");
			if (!chunk) return;
			this.buffer += chunk;
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let parsed: unknown;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}
				this.opts.processRecord(parsed);
			}

			// Mark initial sync done after first successful pump
			if (!this.initialSyncDone) {
				this.initialSyncDone = true;
				this.log(`Initial sync done, will now emit events`);
			}
		} catch (err) {
			this.log(`Error in pump: ${err instanceof Error ? err.stack : err}`);
			await this.closeHandle();
			this.filePath = null;
		} finally {
			this.pumping = false;
		}
	}
}
