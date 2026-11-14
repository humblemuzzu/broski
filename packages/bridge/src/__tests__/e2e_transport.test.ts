/**
 * The loopback listener end to end, over a real in-process bridge server on a random port with a temp
 * HOME, no agents and no network: auth, origin and TLS policy, what a client frame that is not a contract
 * frame gets, the rate limit, and a graceful stop.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { PROTOCOL_VERSION } from "../contract";
import {
	type BridgeHandle,
	connect,
	connectWs,
	E2E_TEST_TIMEOUT_MS,
	type MessageCollector,
	send,
	setupTestEnv,
	startBridge,
	timerProbe,
	upgradeStatus,
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

function hello(ws: WebSocket, requestId: string): void {
	send(ws, {
		type: "contract",
		message: { type: "hello", requestId, protocol: PROTOCOL_VERSION, client: { name: "e2e", version: "0" } },
	});
}

/** The contract message of the first contract frame answering `requestId`, or carrying none when `requestId` is undefined. */
function answer(messages: MessageCollector, requestId: string | undefined) {
	return messages.waitForWhere((frame) => {
		const message = frame.message as Record<string, unknown> | undefined;
		return frame.type === "contract" && message?.requestId === requestId;
	}, `the answer to ${requestId}`);
}

describe("e2e auth", () => {
	test("a valid token connects and the core answers its hello", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			hello(client.ws, "hello-1");
			const frame = await answer(client.messages, "hello-1");
			expect(frame.message).toMatchObject({ type: "hello.result", protocol: PROTOCOL_VERSION });
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

describe("e2e frames that are not contract frames", () => {
	test("invalid JSON and a foreign frame type are answered invalid_message, and the socket survives", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			client.ws.send("{not json");
			send(client.ws, { type: "set_view", sessionId: "s1" });
			await client.messages.waitForWhere(
				() => client.messages.all().filter(isInvalidMessage).length === 2,
				"two invalid_message answers",
			);
			hello(client.ws, "after");
			expect((await answer(client.messages, "after")).message).toMatchObject({ type: "hello.result" });
		} finally {
			client.ws.close();
		}
	});
});

function isInvalidMessage(frame: Record<string, unknown>): boolean {
	const message = frame.message as { type?: string; error?: { code?: string } } | undefined;
	return frame.type === "contract" && message?.type === "error" && message.error?.code === "invalid_message";
}

describe("e2e rate limit", () => {
	test("a socket that floods past the burst is answered rate_limited", async () => {
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
				for (let i = 0; i < 40; i += 1) hello(client.ws, `flood-${i}`);
				const refused = await client.messages.waitForWhere((frame) => {
					const message = frame.message as { type?: string; error?: { code?: string } } | undefined;
					return message?.type === "error" && message.error?.code === "rate_limited";
				}, "rate_limited");
				expect((refused.message as { requestId?: string }).requestId).toMatch(/^flood-/);
				expect((await answer(client.messages, "flood-0")).message).toMatchObject({ type: "hello.result" });
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
	test("stop() releases the port, drops clients, stops the core and leaves no timer running", async () => {
		const probe = timerProbe();
		try {
			const baseline = probe.live();
			const disposable = await startBridge();
			const client = await connect(disposable.port, disposable.token);
			hello(client.ws, "before-stop");
			await answer(client.messages, "before-stop");
			expect(disposable.server.connections()).toBe(1);
			expect(probe.live()).toBeGreaterThan(baseline);

			const result = (await disposable.stop()) as {
				timedOut: boolean;
				completed: string[];
				pending: string[];
				failed: unknown[];
			};
			expect(result).toMatchObject({ timedOut: false, completed: ["backends"], pending: [], failed: [] });
			const deadline = Date.now() + 5000;
			while (disposable.server.connections() > 0 && Date.now() < deadline) await Bun.sleep(10);
			expect(disposable.server.connections()).toBe(0);
			await expect(connectWs(disposable.port, disposable.token, 1000)).rejects.toThrow();
			expect(probe.live()).toBe(baseline);
		} finally {
			probe.restore();
		}
	});
});
