/**
 * In-process bridge server on a random port, isolated from the developer's real config.
 *
 * `os.homedir()` is fixed at process start, so `HOME` here is only advisory: the real isolation is
 * the temp Pi agent dir, a server started without Claude Code's terminal hook unless a test gives
 * it a temp config dir, and the real-home guard `bun test` arms in its preload. The server module
 * is imported lazily so `PI_CODING_AGENT_DIR` is set first.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeServer, BridgeServerOptions } from "../../server";

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
	waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
	waitForWhere: (
		predicate: (message: Record<string, unknown>) => boolean,
		label: string,
		timeoutMs?: number,
	) => Promise<Record<string, unknown>>;
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
			push(parsed as Record<string, unknown>);
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
		waitFor: (type: string, timeoutMs = E2E_WAIT_MS) =>
			waitForWhere((message) => message.type === type, type, timeoutMs),
		waitForWhere,
	};
}

export async function connectWs(port: number, token: string, timeoutMs = E2E_WAIT_MS): Promise<WebSocket> {
	return (await connect(port, token, timeoutMs)).ws;
}

/** Opens a socket with the message collector already attached, so no frame slips past it. */
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
				// The sample nonce of RFC 6455 section 1.3: any 16 bytes in base64 will do.
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
