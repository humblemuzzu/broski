/**
 * Writes to a native PTY master fd.
 *
 * The master is opened O_NONBLOCK, so a write never waits for the child to read; what it does cost
 * is the kernel copy, measured at ~2 ms per 64 KiB on macOS. Chunking bounds that to one short
 * syscall per turn and lets the event loop run between chunks, and the queue keeps two writes from
 * interleaving their chunks when one of them has to wait for buffer space.
 */

import { ptr } from "bun:ffi";

const WRITE_CHUNK_BYTES = 16 * 1024;
const WRITE_RETRY_MS = 4;

const EAGAIN = process.platform === "darwin" ? 35 : 11;
const EWOULDBLOCK = process.platform === "darwin" ? 35 : 11;
const EINTR = 4;

export type PtyWriteSymbols = {
	pty_write: (fd: number, data: ReturnType<typeof ptr>, len: number) => number;
	pty_errno: () => number;
};

export type PtyWriterOptions = {
	fd: number;
	symbols: PtyWriteSymbols;
	/** False once the session is gone, so a queued write stops instead of writing to a closed fd. */
	isActive: () => boolean;
};

export type PtyWriter = {
	write: (data: Uint8Array) => void;
};

export function createPtyWriter(options: PtyWriterOptions): PtyWriter {
	let queue: Promise<void> = Promise.resolve();

	const writeAll = async (buffer: Uint8Array): Promise<void> => {
		let offset = 0;

		while (offset < buffer.length) {
			if (!options.isActive()) return;

			const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + WRITE_CHUNK_BYTES));
			let written: number;
			try {
				written = options.symbols.pty_write(options.fd, ptr(chunk), chunk.length);
			} catch {
				return;
			}

			if (written > 0) {
				offset += written;
				if (offset < buffer.length) await Bun.sleep(0);
				continue;
			}

			const err = options.symbols.pty_errno();
			if (err === EAGAIN || err === EWOULDBLOCK || err === EINTR) {
				await Bun.sleep(WRITE_RETRY_MS);
				continue;
			}
			return;
		}
	};

	return {
		write: (data) => {
			if (data.length === 0) return;
			queue = queue.then(() => writeAll(data));
		},
	};
}
