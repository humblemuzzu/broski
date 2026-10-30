/**
 * End-to-end WebSocket contract, over a real in-process bridge server on a random port with a temp
 * HOME, no agents and no network. Covers auth, origin/TLS policy, message routing replies, rate
 * limiting, batching, device registration and graceful shutdown.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	type BridgeHandle,
	connect,
	connectWs,
	E2E_TEST_TIMEOUT_MS,
	E2E_WAIT_MS,
	send,
	setupTestEnv,
	stalledClient,
	startBridge,
	timerProbe,
	upgradeStatus,
	viewSession,
} from "./e2e/harness";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
let bridge: BridgeHandle;

beforeAll(
	async () => {
		bridge = await startBridge();
	},
	{ timeout: E2E_TEST_TIMEOUT_MS },
);

afterAll(async () => {
	await bridge.stop();
	env.restore();
});

describe("e2e auth", () => {
	test("a valid token connects and receives status", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			const status = await client.messages.waitFor("status");
			expect(status.type).toBe("status");
		} finally {
			client.ws.close();
		}
	});

	test("a bad token is rejected with 401", async () => {
		expect(await upgradeStatus(bridge.port, { token: "wrong-token-000000000000" })).toBe(401);
	});

	test("a missing token is rejected with 401", async () => {
		expect(await upgradeStatus(bridge.port, { token: null })).toBe(401);
	});
});

describe("e2e origin policy (dev mode, TLS off)", () => {
	test("the server reports TLS disabled", () => {
		expect(bridge.server.tls().enabled).toBe(false);
	});

	test("a loopback origin is allowed through the upgrade", async () => {
		expect(await upgradeStatus(bridge.port, { token: bridge.token, origin: `http://127.0.0.1:${bridge.port}` })).toBe(
			101,
		);
	});

	test("an unknown origin is rejected with 403", async () => {
		expect(await upgradeStatus(bridge.port, { token: bridge.token, origin: "http://evil.example" })).toBe(403);
	});
});

describe("e2e device registration", () => {
	test("register_device answers with sessions_active for every backend", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, { type: "register_device", deviceId: "e2e-dev-1", deviceName: "Phone", platform: "ios" });
			await client.messages.waitFor("device_registered");
			const active = await client.messages.waitFor("sessions_active");
			const data = active.data as Record<string, unknown>;
			expect(Array.isArray(data.claudeCode)).toBe(true);
			expect(Array.isArray(data.codex)).toBe(true);
			expect(Array.isArray(data.opencode)).toBe(true);
			expect(data.pendingPermissions).toBeDefined();
		} finally {
			client.ws.close();
		}
	});
});

describe("e2e backend status", () => {
	test("get_agents_status reports each backend the old protocol serves", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, { type: "get_agents_status", requestId: "status-1" });
			const reply = await client.messages.waitFor("agents_status");
			const data = reply.data as Record<string, Record<string, unknown>>;
			expect(Object.keys(data).sort()).toEqual(["claude-code", "codex", "opencode"]);
		} finally {
			client.ws.close();
		}
	});
});

describe("e2e message routing replies", () => {
	test("an unknown message type is answered with the pre-registry error", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, { type: "totally_not_a_real_type" });
			const error = await client.messages.waitFor("error");
			expect(error.message).toBe("Unknown message type");
		} finally {
			client.ws.close();
		}
	});

	test("an invalid payload is answered with the shape error", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, { type: "pty_resize", ptyId: "p1", rows: "24", cols: 80 });
			const error = await client.messages.waitFor("error");
			expect(String(error.message)).toContain('Invalid message payload: field "rows" must be a number');
		} finally {
			client.ws.close();
		}
	});

	test("invalid JSON is answered with an error and the socket survives", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			client.ws.send("{not json");
			const error = await client.messages.waitFor("error");
			expect(error.message).toBe("Invalid JSON payload");
			send(client.ws, { type: "client_ping", id: "alive", sentAt: Date.now() });
			expect((await client.messages.waitFor("client_pong")).id).toBe("alive");
		} finally {
			client.ws.close();
		}
	});

	test("a batch runs every message and answers each one", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, {
				type: "batch",
				messages: [
					{ type: "client_ping", id: "batch-a", sentAt: 1 },
					{ type: "client_ping", id: "batch-b", sentAt: 2 },
				],
			});
			const ids = new Set<string>();
			for (let i = 0; i < 2; i += 1) {
				const pong = await client.messages.waitForWhere(
					(m) => m.type === "client_pong" && !ids.has(String(m.id)),
					"client_pong",
				);
				ids.add(String(pong.id));
			}
			expect([...ids].sort()).toEqual(["batch-a", "batch-b"]);
		} finally {
			client.ws.close();
		}
	});

	test("an oversized batch is rejected without running it", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			const batch = Array.from({ length: 51 }, (_, i) => ({ type: "client_ping", id: `over-${i}`, sentAt: i }));
			send(client.ws, { type: "batch", messages: batch });
			const error = await client.messages.waitFor("error");
			expect(String(error.message)).toContain("Batch too large");
			expect(client.messages.ofType("client_pong")).toHaveLength(0);
		} finally {
			client.ws.close();
		}
	});
});

describe("e2e reconnects and backend switching", () => {
	test("rapid set_view switching across backends keeps the socket alive", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			for (let i = 0; i < 20; i += 1) {
				const agent = ["claude-code", "opencode", "codex"][i % 3];
				send(client.ws, { type: "set_view", agent, sessionId: `switch-${i}`, projectPath: "/tmp/e2e-switch" });
			}
			await Bun.sleep(150);
			send(client.ws, { type: "get_agents_status", requestId: "alive" });
			expect((await client.messages.waitFor("agents_status")).type).toBe("agents_status");
		} finally {
			client.ws.close();
		}
	});

	test("rapid connect/disconnect cycles leave the server healthy", async () => {
		for (let i = 0; i < 5; i += 1) {
			const client = await connect(bridge.port, bridge.token);
			client.ws.close();
			await Bun.sleep(20);
		}
		const client = await connect(bridge.port, bridge.token);
		try {
			send(client.ws, { type: "get_agents_status", requestId: "final" });
			expect((await client.messages.waitFor("agents_status")).type).toBe("agents_status");
		} finally {
			client.ws.close();
		}
	});

	test("set_agent for every backend does not crash the socket", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			for (const agent of ["opencode", "claude-code", "codex"]) {
				send(client.ws, { type: "set_agent", agent });
			}
			await Bun.sleep(100);
			send(client.ws, { type: "get_agents_status", requestId: "post" });
			expect((await client.messages.waitFor("agents_status")).type).toBe("agents_status");
		} finally {
			client.ws.close();
		}
	});
});

describe("e2e rate limit", () => {
	test("a socket that floods past the burst is told RATE_LIMITED", async () => {
		const previous = {
			per: process.env.BROSKI_RATE_LIMIT_PER_SEC,
			burst: process.env.BROSKI_RATE_LIMIT_BURST,
			block: process.env.BROSKI_RATE_LIMIT_BLOCK_MS,
		};
		process.env.BROSKI_RATE_LIMIT_PER_SEC = "10";
		process.env.BROSKI_RATE_LIMIT_BURST = "10";
		process.env.BROSKI_RATE_LIMIT_BLOCK_MS = "1000";
		const limited = await startBridge();
		try {
			const client = await connect(limited.port, limited.token);
			try {
				for (let i = 0; i < 40; i += 1) send(client.ws, { type: "client_ping", id: `flood-${i}`, sentAt: i });
				const error = await client.messages.waitForWhere(
					(m) => m.type === "error" && m.message === "RATE_LIMITED",
					"RATE_LIMITED",
				);
				expect(error.message).toBe("RATE_LIMITED");
				expect(client.messages.ofType("client_pong").length).toBeGreaterThan(0);
			} finally {
				client.ws.close();
			}
		} finally {
			await limited.stop();
			if (previous.per === undefined) delete process.env.BROSKI_RATE_LIMIT_PER_SEC;
			else process.env.BROSKI_RATE_LIMIT_PER_SEC = previous.per;
			if (previous.burst === undefined) delete process.env.BROSKI_RATE_LIMIT_BURST;
			else process.env.BROSKI_RATE_LIMIT_BURST = previous.burst;
			if (previous.block === undefined) delete process.env.BROSKI_RATE_LIMIT_BLOCK_MS;
			else process.env.BROSKI_RATE_LIMIT_BLOCK_MS = previous.block;
		}
	});
});

describe("e2e graceful stop", () => {
	test("stop() releases the port, drops clients and reports every cleanup", async () => {
		const probe = timerProbe();
		try {
			const baseline = probe.live();
			const disposable = await startBridge();
			const client = await connect(disposable.port, disposable.token);
			await viewSession(client.ws, client.messages, "claude-code", "stop-session");
			expect(disposable.server.connections()).toBe(1);
			expect(probe.live()).toBeGreaterThan(baseline);

			const result = (await disposable.stop()) as {
				timedOut: boolean;
				completed: string[];
				pending: string[];
				failed: unknown[];
			};
			expect(result.timedOut).toBe(false);
			expect(result.pending).toEqual([]);
			expect(result.failed).toEqual([]);
			for (const task of ["external-tails", "event-buffers", "fs-watchers", "pty-runtime", "codex-app-server"]) {
				expect(result.completed).toContain(task);
			}
			expect(disposable.server.connections()).toBe(0);
			await expect(connectWs(disposable.port, disposable.token, 1000)).rejects.toThrow();
			// Nothing the server started may still be ticking: every timer it armed was cleared.
			expect(probe.live()).toBe(baseline);
		} finally {
			probe.restore();
		}
	});
});

describe("e2e stalled client", () => {
	test("a socket that never reads is shed while a healthy one keeps its stream", async () => {
		const disposable = await startBridge();
		const healthy = await connect(disposable.port, disposable.token);
		try {
			await viewSession(healthy.ws, healthy.messages, "claude-code", "shed-session");

			stalledClient(disposable.port, disposable.token, "shed-session");
			const deadline = Date.now() + E2E_WAIT_MS;
			while (disposable.server.connections() < 2 && Date.now() < deadline) await Bun.sleep(20);
			expect(disposable.server.connections()).toBe(2);
			await Bun.sleep(100);

			let healthyChars = 0;
			healthy.ws.addEventListener("message", (event) => {
				if (typeof event.data !== "string") return;
				try {
					const parsed = JSON.parse(event.data) as Record<string, unknown>;
					const batch = parsed.type === "batch" ? (parsed.messages as unknown[]) : [parsed];
					for (const raw of batch) {
						const message = raw as Record<string, unknown>;
						if (message.type !== "runtime_event") continue;
						const data = message.data as Record<string, unknown>;
						if (data?.type === "assistant_text_delta") healthyChars += String(data.delta ?? "").length;
					}
				} catch {
					// ignore
				}
			});

			const delta = "x".repeat(1000);
			const events = 40_000;
			const chunk = 500;
			let sent = 0;
			while (sent < events && disposable.server.connections() >= 2) {
				for (let i = 0; i < chunk; i += 1) {
					disposable.server.broadcast({
						type: "runtime_event",
						backend: "claude-code",
						data: {
							type: "assistant_text_delta",
							backend: "claude-code",
							timestampMs: Date.now(),
							sessionId: "shed-session",
							streamId: "shed-stream",
							delta,
						},
					});
				}
				sent += chunk;
				await Bun.sleep(1);
			}
			// The stalled socket is closed server-side; the raw socket never reads the close frame,
			// so the observable signal is the connection count dropping.
			expect(disposable.server.connections()).toBe(1);

			const drainDeadline = Date.now() + E2E_WAIT_MS;
			while (Date.now() < drainDeadline && healthyChars < sent * delta.length) await Bun.sleep(25);
			expect(healthyChars).toBe(sent * delta.length);
		} finally {
			healthy.ws.close();
			await disposable.stop();
		}
	});
});
