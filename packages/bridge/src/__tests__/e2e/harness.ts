/**
 * In-process bridge server on a random port, isolated from the developer's real config.
 *
 * `os.homedir()` is fixed at process start, so `HOME` here is only advisory: the real isolation is
 * the stubbed hook installers, the temp Pi agent dir, and the real-home guard `bun test` arms in
 * its preload. The server module is imported lazily so `PI_CODING_AGENT_DIR` is set first.
 */

import { mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeServer, BridgeServerOptions } from "../../server";

/**
 * `os.homedir()` is fixed at process start, so a server started in-process would install its
 * Claude Code permission hook into the developer's real `~/.claude`. The
 * installers are the only thing that writes there, so they are stubbed out for every e2e file.
 */
mock.module("../../handlers/cc_hook_installer", () => ({
	HOOK_MARKER: "broski-permission-proxy",
	ccHookSettingsPath: () => "/nonexistent/broski-e2e/.claude/settings.json",
	installCcHook: async () => {},
	uninstallCcHook: async () => {},
}));

export type TestEnv = {
	home: string;
	piAgentDir: string;
	restore: () => void;
};

const ENV_KEYS = ["HOME", "USERPROFILE", "BROSKI_TLS", "PI_CODING_AGENT_DIR", "BROSKI_WS_DEFLATE"] as const;

/** Points HOME and the Pi agent dir at a fresh temp tree; call before importing the server. */
export function setupTestEnv(): TestEnv {
	const previous = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
	const home = mkdtempSync(join(tmpdir(), "broski-e2e-home-"));
	const piAgentDir = join(home, "pi-agent");
	mkdirSync(piAgentDir, { recursive: true });
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	process.env.BROSKI_TLS = "0";
	process.env.PI_CODING_AGENT_DIR = piAgentDir;
	return {
		home,
		piAgentDir,
		restore: () => {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(home, { recursive: true, force: true });
		},
	};
}

export const E2E_TOKEN = "e2e-token-0123456789abcdef";

/**
 * Frames these tests await come from real backend probes and SDK loads, which a busy machine can
 * stretch well past a second. A genuine hang still fails the caller's test timeout.
 */
export const E2E_WAIT_MS = 20_000;

/** Child processes and agent probes are inherent to an e2e file, so its tests get headroom. */
export const E2E_TEST_TIMEOUT_MS = 30_000;

export type BridgeHandle = {
	server: BridgeServer;
	port: number;
	token: string;
	stop: () => Promise<unknown>;
};

export async function startBridge(overrides: Partial<BridgeServerOptions> = {}): Promise<BridgeHandle> {
	process.env.BROSKI_TLS = "0";
	const { createBridgeServer } = await import("../../server");
	const auth = {
		version: 1 as const,
		token: E2E_TOKEN,
		createdAt: Date.now(),
	};
	const server = await createBridgeServer({
		port: 0,
		version: "0.0.0-e2e",
		auth,
		...overrides,
	});
	return { server, port: server.port(), token: server.authToken(), stop: () => server.stop(true) };
}

export type MessageCollector = {
	all: () => Array<Record<string, unknown>>;
	clear: () => void;
	waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
	waitForWhere: (
		predicate: (message: Record<string, unknown>) => boolean,
		label: string,
		timeoutMs?: number,
	) => Promise<Record<string, unknown>>;
	ofType: (type: string) => Array<Record<string, unknown>>;
};

export function collect(ws: WebSocket): MessageCollector {
	const messages: Array<Record<string, unknown>> = [];
	const waiters: Array<{
		predicate: (message: Record<string, unknown>) => boolean;
		label: string;
		resolve: (message: Record<string, unknown>) => void;
		timer: Timer;
	}> = [];

	const push = (message: Record<string, unknown>) => {
		messages.push(message);
		for (const waiter of [...waiters]) {
			if (!waiter.predicate(message)) continue;
			clearTimeout(waiter.timer);
			waiters.splice(waiters.indexOf(waiter), 1);
			waiter.resolve(message);
		}
	};

	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		try {
			const parsed: unknown = JSON.parse(event.data);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
			const record = parsed as Record<string, unknown>;
			// The send queue wraps several frames into one `batch` envelope; the app sees the
			// inner messages, so the collector does too.
			if (record.type === "batch" && Array.isArray(record.messages)) {
				for (const inner of record.messages) {
					if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
						push(inner as Record<string, unknown>);
					}
				}
				return;
			}
			push(record);
		} catch {
			// non-JSON frames are never part of the contract
		}
	});

	const waitForWhere = (
		predicate: (message: Record<string, unknown>) => boolean,
		label: string,
		timeoutMs = E2E_WAIT_MS,
	) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const existing = messages.find(predicate);
			if (existing) return resolve(existing);
			const timer = setTimeout(() => {
				const index = waiters.findIndex((waiter) => waiter.timer === timer);
				if (index >= 0) waiters.splice(index, 1);
				reject(new Error(`timeout waiting for ${label} (saw: ${messages.map((m) => m.type).join(", ")})`));
			}, timeoutMs);
			waiters.push({ predicate, label, resolve, timer });
		});

	return {
		all: () => [...messages],
		clear: () => {
			messages.length = 0;
		},
		ofType: (type: string) => messages.filter((message) => message.type === type),
		waitFor: (type: string, timeoutMs = E2E_WAIT_MS) =>
			waitForWhere((message) => message.type === type, type, timeoutMs),
		waitForWhere,
	};
}

export async function connectWs(port: number, token: string, timeoutMs = E2E_WAIT_MS): Promise<WebSocket> {
	return (await connect(port, token, timeoutMs)).ws;
}

/**
 * Opens a socket with the message collector already attached, so the `status` frame the server
 * sends on open cannot slip past the listener before it is registered.
 */
export async function connect(
	port: number,
	token: string,
	timeoutMs = E2E_WAIT_MS,
): Promise<{ ws: WebSocket; messages: MessageCollector }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`broski-auth.${token}`]);
		const messages = collect(ws);
		const timer = setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
		ws.onopen = () => {
			clearTimeout(timer);
			resolve({ ws, messages });
		};
		ws.onerror = () => {
			clearTimeout(timer);
			reject(new Error("ws connect error"));
		};
	});
}

/** Points the socket at a session and waits until the server has processed the view. */
export async function viewSession(
	ws: WebSocket,
	messages: MessageCollector,
	agent: string,
	sessionId: string,
): Promise<void> {
	await messages.waitFor("status");
	messages.clear();
	send(ws, { type: "set_view", agent, sessionId });
	await messages.waitFor("status");
}

export function send(ws: WebSocket, message: Record<string, unknown>): void {
	ws.send(JSON.stringify(message));
}

/** Sends one WebSocket upgrade over a raw socket and resolves with the HTTP status line. */
export function upgradeStatus(
	port: number,
	options: { token?: string | null; origin?: string | null; host?: string } = {},
): Promise<number> {
	return new Promise((resolve, reject) => {
		const socket = netConnect(port, "127.0.0.1");
		let buffer = "";
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error("upgrade response timeout"));
		}, 5000);
		socket.on("connect", () => {
			const lines = [
				"GET /ws HTTP/1.1",
				`Host: ${options.host ?? `127.0.0.1:${port}`}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version: 13",
			];
			if (options.token) lines.push(`Sec-WebSocket-Protocol: broski-auth.${options.token}`);
			if (options.origin) lines.push(`Origin: ${options.origin}`);
			socket.write(`${lines.join("\r\n")}\r\n\r\n`);
		});
		socket.on("data", (chunk) => {
			buffer += chunk.toString("latin1");
			const match = buffer.match(/^HTTP\/1\.1 (\d{3})/);
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

/** A phone that stopped reading: completes the handshake, asks to view a session, then pauses. */
export function stalledClient(
	port: number,
	token: string,
	sessionId: string,
	agent = "claude-code",
): { closed: () => boolean } {
	const socket = netConnect(port, "127.0.0.1");
	let closed = false;
	socket.on("close", () => {
		closed = true;
	});
	socket.on("error", () => {
		closed = true;
	});
	socket.on("connect", () => {
		socket.write(
			[
				"GET /ws HTTP/1.1",
				`Host: 127.0.0.1:${port}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version: 13",
				`Sec-WebSocket-Protocol: broski-auth.${token}`,
				"",
				"",
			].join("\r\n"),
		);
	});
	let watched = false;
	socket.on("data", () => {
		if (watched) return;
		watched = true;
		socket.write(maskedTextFrame(JSON.stringify({ type: "set_view", agent, sessionId })));
		socket.pause();
	});
	return { closed: () => closed };
}

function maskedTextFrame(text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	const mask = Buffer.from([1, 2, 3, 4]);
	const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
	header[0] = 0x81;
	if (payload.length < 126) {
		header[1] = 0x80 | payload.length;
		mask.copy(header, 2);
	} else {
		header[1] = 0x80 | 126;
		header.writeUInt16BE(payload.length, 2);
		mask.copy(header, 4);
	}
	const masked = Buffer.alloc(payload.length);
	for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i]! ^ mask[i % 4]!;
	return Buffer.concat([header, masked]);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Counts the timers created and not yet cleared, so a test can prove a `stop()` path leaves none
 * behind. Bun exposes no handle introspection, so the globals are wrapped for the duration.
 */
export function timerProbe(): { live: () => number; restore: () => void } {
	const realSetTimeout = globalThis.setTimeout;
	const realSetInterval = globalThis.setInterval;
	const realClearTimeout = globalThis.clearTimeout;
	const realClearInterval = globalThis.clearInterval;
	const live = new Set<unknown>();

	globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
		const handle = realSetTimeout(handler, timeout, ...args);
		live.add(handle);
		return handle;
	}) as typeof setTimeout;
	globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
		const handle = realSetInterval(handler, timeout, ...args);
		live.add(handle);
		return handle;
	}) as typeof setInterval;
	globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
		live.delete(handle);
		return realClearTimeout(handle);
	}) as typeof clearTimeout;
	globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
		live.delete(handle);
		return realClearInterval(handle);
	}) as typeof clearInterval;

	return {
		live: () => live.size,
		restore: () => {
			globalThis.setTimeout = realSetTimeout;
			globalThis.setInterval = realSetInterval;
			globalThis.clearTimeout = realClearTimeout;
			globalThis.clearInterval = realClearInterval;
		},
	};
}

export function writeJsonlSession(dir: string, name: string, lines: unknown[]): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return path;
}
