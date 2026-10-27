import { createConnection, type Socket } from "node:net";

const HANDSHAKE_TIMEOUT_MS = 3_000;
const READ_LIMIT = 64 * 1024;

export type UnixStatus = { status: number } | { status: null; error: string };

/** One websocket upgrade over a unix socket, answered with its HTTP status (101 when accepted). */
export function unixUpgradeStatus(path: string, headers: Record<string, string>): Promise<UnixStatus> {
	const request = [
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
	return new Promise((resolve) => {
		const socket = createConnection({ path });
		const finish = (result: UnixStatus): void => {
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};
		const timer = setTimeout(() => finish({ status: null, error: "the socket did not answer" }), HANDSHAKE_TIMEOUT_MS);
		socket.once("connect", () => socket.write(request));
		socket.once("error", (error: Error) => finish({ status: null, error: error.message }));
		socket.on("data", (chunk: Buffer) => {
			const match = /^HTTP\/1\.1 (\d{3})/.exec(chunk.toString("latin1"));
			if (match?.[1]) finish({ status: Number(match[1]) });
		});
	});
}

/** One JSON line over the daemon's control socket, or null when it does not answer. */
export function controlRequest(
	path: string,
	request: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const socket: Socket = createConnection({ path });
		let text = "";
		const finish = (value: Record<string, unknown> | null): void => {
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(value);
		};
		const timer = setTimeout(() => finish(null), HANDSHAKE_TIMEOUT_MS);
		socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		socket.once("error", () => finish(null));
		socket.on("data", (chunk: Buffer) => {
			text += chunk.toString("utf8");
			const line = text.split("\n")[0]?.trim() ?? "";
			if (!line.startsWith("{")) {
				if (text.length > READ_LIMIT) finish(null);
				return;
			}
			try {
				const parsed: unknown = JSON.parse(line);
				finish(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null);
			} catch {
				finish(null);
			}
		});
	});
}
