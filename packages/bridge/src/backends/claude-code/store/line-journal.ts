/** Lane A · a bounded append-only file of JSON lines, which never throws: a write that fails is dropped. */

import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { writeAtomic } from "../files/atomic-write";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export class LineJournal {
	private tail: Promise<void> = Promise.resolve();
	private ready = false;

	constructor(
		private readonly path: string,
		private readonly maxReadBytes: number,
	) {}

	/** The complete lines of the last `maxReadBytes` of the file; none when it is missing or unreadable. */
	async read(): Promise<string[]> {
		try {
			const { size } = await stat(this.path);
			const length = Math.min(size, this.maxReadBytes);
			const handle = await open(this.path, "r");
			try {
				const buffer = Buffer.alloc(length);
				const { bytesRead } = await handle.read(buffer, 0, length, size - length);
				const lines = buffer.toString("utf8", 0, bytesRead).split("\n");
				if (size > length) lines.shift();
				return lines.filter((line) => line !== "");
			} finally {
				await handle.close();
			}
		} catch {
			return [];
		}
	}

	append(line: string): Promise<void> {
		return this.enqueue(async () => {
			await this.prepare();
			await appendFile(this.path, `${line}\n`, { mode: FILE_MODE });
		});
	}

	/** Replaces the file with `lines` through a temporary file, so a crash leaves the old one or the new one. */
	rewrite(lines: readonly string[]): Promise<void> {
		return this.enqueue(async () => {
			await this.prepare();
			await writeAtomic(this.path, lines.length === 0 ? "" : `${lines.join("\n")}\n`, { mode: FILE_MODE });
		});
	}

	private async prepare(): Promise<void> {
		if (this.ready) return;
		await mkdir(dirname(this.path), { recursive: true, mode: DIR_MODE });
		this.ready = true;
	}

	private enqueue(work: () => Promise<void>): Promise<void> {
		this.tail = this.tail.then(work).catch(() => undefined);
		return this.tail;
	}
}
