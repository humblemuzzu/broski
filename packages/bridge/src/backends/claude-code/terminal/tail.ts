/** Positional reads of a transcript as it grows, whole lines only; never a whole-file read (research 04 §7 rec. 5). */

import { type FileHandle, open } from "node:fs/promises";
import { JsonlLines } from "./jsonl-lines";

/** What a reset re-reads: the newest bytes of the file, whose lines are told apart by uuid. */
export const BASELINE_BYTES = 512 * 1_024;
const CHUNK_BYTES = 64 * 1_024;
const MAX_BYTES_PER_READ = 8 * 1_048_576;

export interface TailRead {
	readonly lines: readonly string[];
	/** The file shrank or was replaced: `lines` are the newest of a fresh read, some may be old. */
	readonly reset: boolean;
	/** The file is gone. */
	readonly gone: boolean;
	/** More bytes are waiting than one read takes: read again. */
	readonly more: boolean;
}

const NOTHING: TailRead = { lines: [], reset: false, gone: false, more: false };

export class TranscriptTail {
	private offset = 0;
	private ino: number | undefined;
	private lines = new JsonlLines();

	constructor(readonly path: string) {}

	/** Starts at the end of the file; the lines of its last `BASELINE_BYTES` are returned for the caller to remember. */
	async attach(): Promise<readonly string[]> {
		return (await this.rebaseline()).lines;
	}

	async read(): Promise<TailRead> {
		let handle: FileHandle;
		try {
			handle = await open(this.path, "r");
		} catch (error) {
			return isMissing(error) ? { ...NOTHING, gone: true } : NOTHING;
		}
		try {
			const stat = await handle.stat();
			if (stat.ino !== this.ino || stat.size < this.offset) {
				return await this.rebaselineFrom(handle, stat.size, stat.ino);
			}
			const lines = await this.readTo(handle, stat.size);
			return {
				lines,
				reset: false,
				gone: false,
				more: this.offset < stat.size,
			};
		} catch {
			return NOTHING;
		} finally {
			await handle.close();
		}
	}

	private async rebaseline(): Promise<TailRead> {
		let handle: FileHandle;
		try {
			handle = await open(this.path, "r");
		} catch {
			return NOTHING;
		}
		try {
			const stat = await handle.stat();
			return await this.rebaselineFrom(handle, stat.size, stat.ino);
		} catch {
			return NOTHING;
		} finally {
			await handle.close();
		}
	}

	private async rebaselineFrom(handle: FileHandle, size: number, ino: number): Promise<TailRead> {
		this.ino = ino;
		this.lines = new JsonlLines();
		const from = Math.max(0, size - BASELINE_BYTES);
		this.offset = from;
		const window = await this.readTo(handle, size);
		return {
			lines: from === 0 ? window : window.slice(1),
			reset: true,
			gone: false,
			more: this.offset < size,
		};
	}

	private async readTo(handle: FileHandle, size: number): Promise<string[]> {
		const out: string[] = [];
		const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
		const stop = Math.min(size, this.offset + MAX_BYTES_PER_READ);
		while (this.offset < stop) {
			const wanted = Math.min(CHUNK_BYTES, stop - this.offset);
			const { bytesRead } = await handle.read(buffer, 0, wanted, this.offset);
			if (bytesRead === 0) break;
			this.offset += bytesRead;
			out.push(...this.lines.push(buffer.subarray(0, bytesRead)));
		}
		return out;
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
