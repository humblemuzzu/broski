/**
 * Minimal WebSocket client over a Unix domain socket. Bun's `WebSocket` cannot dial a unix path and
 * its `fetch` cannot carry frames after the 101, so these tests speak the wire protocol directly.
 */

import { connect as netConnect, type Socket } from "node:net";

const HANDSHAKE_TIMEOUT_MS = 5000;
const MESSAGE_TIMEOUT_MS = 10_000;

export type LinkFrame = Record<string, unknown>;

export type UnixWsClose = { code: number; reason: string };

export type UnixWsClient = {
	send: (message: Record<string, unknown>) => void;
	waitFor: (type: string, timeoutMs?: number) => Promise<LinkFrame>;
	waitForWhere: (predicate: (frame: LinkFrame) => boolean, label: string, timeoutMs?: number) => Promise<LinkFrame>;
	/** The close frame the peer sent, once one has arrived. */
	closed: () => UnixWsClose | null;
	/** Every frame received so far, for assertions on what did *not* arrive. */
	frames: () => LinkFrame[];
	/** Stops reading the socket, the way a daemon does while the phone's window is full. */
	pause: () => void;
	resume: () => void;
	/** Resolves once the peer's close frame arrived, or rejects after `timeoutMs`. */
	waitForClose: (timeoutMs?: number) => Promise<UnixWsClose>;
	clear: () => void;
	close: () => void;
};

function upgradeRequest(headers: Record<string, string>): string {
	return [
		"GET /ws HTTP/1.1",
		"Host: localhost",
		"Upgrade: websocket",
		"Connection: Upgrade",
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
		"Sec-WebSocket-Version: 13",
		...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
		"",
		"",
	].join("\r\n");
}

/** One upgrade over a raw unix socket, resolving with the HTTP status line. */
export function unixUpgradeStatus(path: string, headers: Record<string, string>): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = netConnect({ path });
		let text = "";
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("link upgrade timeout"));
		}, HANDSHAKE_TIMEOUT_MS);
		socket.on("connect", () => socket.write(upgradeRequest(headers)));
		socket.on("data", (chunk: Buffer) => {
			text += chunk.toString("latin1");
			const match = /^HTTP\/1\.1 (\d{3})/.exec(text);
			if (!match) return;
			clearTimeout(timer);
			socket.destroy();
			resolve(Number(match[1]));
		});
		socket.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

export async function connectUnixWs(path: string, headers: Record<string, string>): Promise<UnixWsClient> {
	const { socket, leftover } = await openSocket(path, headers);
	const frames: LinkFrame[] = [];
	const waiters: Array<{
		predicate: (frame: LinkFrame) => boolean;
		resolve: (frame: LinkFrame) => void;
		timer: Timer;
	}> = [];

	const push = (frame: LinkFrame): void => {
		frames.push(frame);
		for (const waiter of [...waiters]) {
			if (!waiter.predicate(frame)) continue;
			clearTimeout(waiter.timer);
			waiters.splice(waiters.indexOf(waiter), 1);
			waiter.resolve(frame);
		}
	};

	let closed: UnixWsClose | null = null;
	let closeWaiters: Array<() => void> = [];
	let pending: Buffer = Buffer.alloc(0);
	const feed = (chunk: Buffer): void => {
		pending = parseFrames(Buffer.concat([pending, chunk]), push, (close) => {
			closed = close;
			const waiting = closeWaiters;
			closeWaiters = [];
			for (const resolve of waiting) resolve();
		});
	};
	socket.on("data", feed);
	feed(leftover);

	const waitForWhere = (
		predicate: (frame: LinkFrame) => boolean,
		label: string,
		timeoutMs = MESSAGE_TIMEOUT_MS,
	): Promise<LinkFrame> =>
		new Promise<LinkFrame>((resolve, reject) => {
			const seen = frames.find(predicate);
			if (seen) return resolve(seen);
			const timer = setTimeout(() => {
				waiters.splice(
					waiters.findIndex((waiter) => waiter.timer === timer),
					1,
				);
				reject(new Error(`timeout waiting for ${label} (saw: ${frames.map((frame) => frame.type).join(", ")})`));
			}, timeoutMs);
			waiters.push({ predicate, resolve, timer });
		});

	return {
		send: (message) => socket.write(maskedTextFrame(JSON.stringify(message))),
		waitFor: (type, timeoutMs = MESSAGE_TIMEOUT_MS) => waitForWhere((frame) => frame.type === type, type, timeoutMs),
		waitForWhere,
		closed: () => closed,
		frames: () => [...frames],
		pause: () => socket.pause(),
		resume: () => socket.resume(),
		waitForClose: (timeoutMs = MESSAGE_TIMEOUT_MS): Promise<UnixWsClose> => {
			if (closed) return Promise.resolve(closed);
			return new Promise<UnixWsClose>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("timeout waiting for the close frame")), timeoutMs);
				closeWaiters.push(() => {
					clearTimeout(timer);
					resolve(closed!);
				});
			});
		},
		clear: () => {
			frames.length = 0;
		},
		close: () => socket.destroy(),
	};
}

function openSocket(path: string, headers: Record<string, string>): Promise<{ socket: Socket; leftover: Buffer }> {
	return new Promise((resolve, reject) => {
		const socket = netConnect({ path });
		let text = "";
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("link handshake timeout"));
		}, HANDSHAKE_TIMEOUT_MS);
		socket.on("connect", () => socket.write(upgradeRequest(headers)));
		socket.on("data", (chunk: Buffer) => {
			// latin1 round-trips every byte, so frames that arrived with the headers stay intact.
			text += chunk.toString("latin1");
			const headerEnd = text.indexOf("\r\n\r\n");
			if (headerEnd === -1) return;
			const status = /^HTTP\/1\.1 (\d{3})/.exec(text);
			clearTimeout(timer);
			socket.removeAllListeners("data");
			if (status?.[1] !== "101") {
				socket.destroy();
				reject(new Error(`link upgrade refused with status ${status?.[1] ?? "unknown"}`));
				return;
			}
			resolve({ socket, leftover: Buffer.from(text.slice(headerEnd + 4), "latin1") });
		});
		socket.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

function parseFrames(
	buffer: Buffer,
	onFrame: (frame: LinkFrame) => void,
	onClose: (close: UnixWsClose) => void,
): Buffer {
	let offset = 0;
	while (offset + 2 <= buffer.length) {
		const opcode = buffer[offset]! & 0x0f;
		const masked = (buffer[offset + 1]! & 0x80) !== 0;
		let length = buffer[offset + 1]! & 0x7f;
		let cursor = offset + 2;
		if (length === 126) {
			if (buffer.length < cursor + 2) break;
			length = buffer.readUInt16BE(cursor);
			cursor += 2;
		} else if (length === 127) {
			if (buffer.length < cursor + 8) break;
			length = Number(buffer.readBigUInt64BE(cursor));
			cursor += 8;
		}
		if (masked) cursor += 4;
		if (buffer.length < cursor + length) break;
		const payload = buffer.subarray(cursor, cursor + length);
		offset = cursor + length;
		if (opcode === 0x8) {
			onClose({
				code: payload.length >= 2 ? payload.readUInt16BE(0) : 0,
				reason: payload.subarray(2).toString("utf8"),
			});
			continue;
		}
		if (opcode !== 0x1) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload.toString("utf8"));
		} catch {
			continue;
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
		const frame = parsed as LinkFrame;
		// The send queue wraps several frames into one `batch` envelope; the app sees the inner messages.
		if (frame.type === "batch" && Array.isArray(frame.messages)) {
			for (const inner of frame.messages) {
				if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) onFrame(inner as LinkFrame);
			}
			continue;
		}
		onFrame(frame);
	}
	return buffer.subarray(offset);
}

function maskedTextFrame(text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	const mask = Buffer.from([1, 2, 3, 4]);
	const lengthBytes = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
	const header = Buffer.alloc(2 + lengthBytes + 4);
	header[0] = 0x81;
	if (lengthBytes === 0) {
		header[1] = 0x80 | payload.length;
	} else if (lengthBytes === 2) {
		header[1] = 0x80 | 126;
		header.writeUInt16BE(payload.length, 2);
	} else {
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(payload.length), 2);
	}
	mask.copy(header, 2 + lengthBytes);
	const masked = Buffer.alloc(payload.length);
	for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i]! ^ mask[i % 4]!;
	return Buffer.concat([header, masked]);
}
