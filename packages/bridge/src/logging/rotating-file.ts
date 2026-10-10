import { closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export type RotatingFileOptions = {
	path: string;
	maxBytes?: number;
	/** Number of rotated files kept alongside the live one. */
	keep?: number;
};

export const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
export const DEFAULT_KEEP_ROTATED = 3;
const REOPEN_BACKOFF_MS = 30_000;

export class RotatingFileWriter {
	private readonly options: Required<RotatingFileOptions>;
	private fd = -1;
	private bytes = 0;
	private retryAfter = 0;

	constructor(options: RotatingFileOptions) {
		this.options = {
			path: options.path,
			maxBytes: options.maxBytes ?? DEFAULT_MAX_LOG_BYTES,
			keep: options.keep ?? DEFAULT_KEEP_ROTATED,
		};
		this.open();
	}

	get path(): string {
		return this.options.path;
	}

	write(chunk: string): void {
		if (this.fd < 0) this.open();
		if (this.fd < 0) return;

		const incoming = Buffer.byteLength(chunk);
		if (this.bytes > 0 && this.bytes + incoming > this.options.maxBytes) {
			this.rotate();
			if (this.fd < 0) return;
		}

		try {
			writeSync(this.fd, chunk);
			this.bytes += incoming;
		} catch {
			this.closeFd();
			this.retryAfter = Date.now() + REOPEN_BACKOFF_MS;
		}
	}

	async close(): Promise<void> {
		this.closeFd();
	}

	private open(): void {
		const now = Date.now();
		if (now < this.retryAfter) return;

		try {
			mkdirSync(dirname(this.options.path), { recursive: true });
			const fd = openSync(this.options.path, "a");
			this.fd = fd;
			this.bytes = fstatSync(fd).size;
		} catch {
			this.fd = -1;
			this.retryAfter = now + REOPEN_BACKOFF_MS;
		}
	}

	private closeFd(): void {
		if (this.fd < 0) return;
		try {
			closeSync(this.fd);
		} catch {
			// Already closed.
		}
		this.fd = -1;
	}

	private rotate(): void {
		this.closeFd();

		const { path, keep } = this.options;
		try {
			rmSync(`${path}.${keep}`, { force: true });
			for (let index = keep - 1; index >= 1; index--) {
				renameIfPresent(`${path}.${index}`, `${path}.${index + 1}`);
			}
			renameSync(path, `${path}.1`);
		} catch {
			// Rotation is best-effort; keep appending to the live file.
		}

		this.bytes = 0;
		this.open();
	}
}

function renameIfPresent(source: string, destination: string): void {
	try {
		renameSync(source, destination);
	} catch {
		// Slot does not exist yet.
	}
}
