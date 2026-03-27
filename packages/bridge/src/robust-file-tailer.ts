/**
 * RobustFileTailer - A robust file tailing utility for real-time session sync
 *
 * Features:
 * - 100ms polling (5x faster than the previous 500ms)
 * - File inode tracking for rotation/replacement detection
 * - Parent directory watching for reliability (fs.watch can miss file events)
 * - Proper truncation handling
 * - Auto-recovery from errors
 */

import { type FSWatcher, watch as fsWatch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname } from "node:path";

const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === "1";

export type FileTailerOptions = {
	/** Polling interval in ms (default: 100ms for real-time sync) */
	pollIntervalMs?: number;
	/** Max bytes to read per pump cycle (default: 512KB) */
	maxBytesPerRead?: number;
	/** Whether to watch parent directory for more reliable notifications */
	watchParentDir?: boolean;
};

export type FileTailerCallbacks = {
	/** Called for each new line in the file */
	onLine: (line: string) => void;
	/** Called when file is truncated/rotated */
	onReset?: () => void;
	/** Called on errors (non-fatal, tailer continues) */
	onError?: (error: Error) => void;
};

export class RobustFileTailer {
	private filePath: string;
	private callbacks: FileTailerCallbacks;
	private pollIntervalMs: number;
	private maxBytesPerRead: number;
	private watchParentDir: boolean;

	private stopped = false;
	private fileHandle: any | null = null;
	private offset = 0;
	private buffer = "";
	private lastIno = 0;
	private lastMtimeMs = 0;
	private pumping = false;
	private pollTimer: Timer | null = null;
	private fileWatcher: FSWatcher | null = null;
	private dirWatcher: FSWatcher | null = null;

	constructor(filePath: string, callbacks: FileTailerCallbacks, options: FileTailerOptions = {}) {
		this.filePath = filePath;
		this.callbacks = callbacks;
		this.pollIntervalMs = options.pollIntervalMs ?? 100;
		this.maxBytesPerRead = options.maxBytesPerRead ?? 512 * 1024;
		this.watchParentDir = options.watchParentDir ?? true;
	}

	async start(): Promise<void> {
		if (this.stopped) return;

		// Try to get initial file stats
		try {
			const st = await stat(this.filePath);
			this.offset = Number(st.size ?? 0);
			this.lastIno = Number(st.ino ?? 0);
			this.lastMtimeMs = st.mtime.getTime();
		} catch {
			// File doesn't exist yet - will be created
			this.offset = 0;
			this.lastIno = 0;
		}

		// Start polling (primary mechanism - most reliable)
		this.pollTimer = setInterval(() => {
			void this.pump();
		}, this.pollIntervalMs);

		// Try to set up file watcher (supplements polling)
		this.setupFileWatcher();

		// Optionally watch parent directory (more reliable on some systems)
		if (this.watchParentDir) {
			this.setupDirWatcher();
		}

		if (DEBUG_RTS) {
			console.log(`[RTS] RobustFileTailer started for ${this.filePath}`);
		}
	}

	stop(): void {
		this.stopped = true;

		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}

		if (this.fileWatcher) {
			try {
				this.fileWatcher.close();
			} catch {}
			this.fileWatcher = null;
		}

		if (this.dirWatcher) {
			try {
				this.dirWatcher.close();
			} catch {}
			this.dirWatcher = null;
		}

		void this.closeHandle();

		if (DEBUG_RTS) {
			console.log(`[RTS] RobustFileTailer stopped for ${this.filePath}`);
		}
	}

	private setupFileWatcher(): void {
		try {
			this.fileWatcher = fsWatch(this.filePath, { persistent: false }, () => {
				void this.pump();
			});
			this.fileWatcher.on("error", () => {
				// File watcher failed, polling will handle it
				if (this.fileWatcher) {
					try {
						this.fileWatcher.close();
					} catch {}
					this.fileWatcher = null;
				}
			});
		} catch {
			// File doesn't exist or not watchable - polling will handle it
		}
	}

	private setupDirWatcher(): void {
		const parentDir = dirname(this.filePath);
		try {
			this.dirWatcher = fsWatch(parentDir, { persistent: false }, (_, filename) => {
				// Only react if our file was affected
				if (filename && this.filePath.endsWith(filename)) {
					void this.pump();
				}
			});
			this.dirWatcher.on("error", () => {
				if (this.dirWatcher) {
					try {
						this.dirWatcher.close();
					} catch {}
					this.dirWatcher = null;
				}
			});
		} catch {
			// Parent dir watching failed - polling will handle it
		}
	}

	private async closeHandle(): Promise<void> {
		if (!this.fileHandle) return;
		try {
			await this.fileHandle.close();
		} catch {}
		this.fileHandle = null;
	}

	private async pump(): Promise<void> {
		if (this.stopped || this.pumping) return;
		this.pumping = true;

		try {
			// Get current file stats
			const st = await stat(this.filePath).catch(() => null);
			if (!st) {
				// File doesn't exist - reset state
				if (this.offset > 0) {
					await this.closeHandle();
					this.offset = 0;
					this.buffer = "";
					this.lastIno = 0;
					this.callbacks.onReset?.();
				}
				return;
			}

			const size = Number(st.size ?? 0);
			const ino = Number(st.ino ?? 0);
			const mtimeMs = st.mtime.getTime();

			// Check for file rotation (inode changed)
			if (this.lastIno !== 0 && ino !== this.lastIno) {
				if (DEBUG_RTS) {
					console.log(`[RTS] File rotated: ${this.filePath} (ino ${this.lastIno} -> ${ino})`);
				}
				await this.closeHandle();
				this.offset = 0;
				this.buffer = "";
				this.callbacks.onReset?.();
			}
			this.lastIno = ino;

			// Check for truncation
			if (size < this.offset) {
				if (DEBUG_RTS) {
					console.log(`[RTS] File truncated: ${this.filePath} (${this.offset} -> ${size})`);
				}
				await this.closeHandle();
				this.offset = 0;
				this.buffer = "";
				this.callbacks.onReset?.();
			}

			// No new data?
			if (size === this.offset) {
				// Check if mtime changed (in-place edits without size change)
				if (mtimeMs > this.lastMtimeMs) {
					this.lastMtimeMs = mtimeMs;
					// File was modified but size didn't change - might be in-place update
					// This is rare for JSONL files but possible
				}
				return;
			}

			this.lastMtimeMs = mtimeMs;

			// Open file handle if needed
			if (!this.fileHandle) {
				this.fileHandle = await open(this.filePath, "r");
			}

			// Read new data
			const toRead = Math.min(size - this.offset, this.maxBytesPerRead);
			const buf = Buffer.alloc(toRead);
			const res = await this.fileHandle.read(buf, 0, toRead, this.offset);
			this.offset += res.bytesRead;

			// Process lines
			const chunk = buf.subarray(0, res.bytesRead).toString("utf-8");
			if (!chunk) return;

			this.buffer += chunk;
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) {
					this.callbacks.onLine(trimmed);
				}
			}
		} catch (error) {
			// Log error but continue (polling will retry)
			this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));

			// Reset file handle on error
			await this.closeHandle();
		} finally {
			this.pumping = false;
		}
	}
}
