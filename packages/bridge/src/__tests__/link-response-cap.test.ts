/**
 * A frame too large for the link: the requester is answered with `response_too_large` instead, the
 * frame is never written, and network sockets on the same bridge are untouched.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeLogger } from "../logging/logger";
import { RESPONSE_TOO_LARGE_CODE, RESPONSE_TOO_LARGE_MESSAGE } from "../transport/send-limits";
import type { ServerMessage } from "../types";
import { type BridgeHandle, connect, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge } from "./e2e/harness";
import { connectUnixWs } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const root = mkdtempSync(join(tmpdir(), "broski-link-cap-"));
const socketPath = join(root, "run", "link.sock");
const DEVICE_HEADERS = {
	"x-broski-device-id": "0123456789abcdef0123456789abcdef",
	"x-broski-device-name": "Cap Phone",
	"x-broski-role": "owner",
};

const MESSAGE_LIMIT_MB = 1;
process.env.BROSKI_LINK_MESSAGE_MB = String(MESSAGE_LIMIT_MB);
const MESSAGE_LIMIT_BYTES = MESSAGE_LIMIT_MB * 1024 * 1024;
const OVERSIZED_BYTES = MESSAGE_LIMIT_BYTES * 2;

const logLines: string[] = [];
const bridgeLogger: BridgeLogger = {
	user: (message) => logLines.push(message),
	info: (message) => logLines.push(message),
	debug: () => {},
	error: () => {},
	flush: async () => {},
};

let bridge: BridgeHandle;

beforeAll(async () => {
	bridge = await startBridge({ linkSocket: socketPath, bridgeLogger });
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await bridge.stop();
	env.restore();
	delete process.env.BROSKI_LINK_MESSAGE_MB;
	rmSync(root, { recursive: true, force: true });
});

/** A cross-session activity event carrying a tool result far past what the link may take. */
function oversizedEvent(sessionId: string): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "tool_started",
			backend: "pi",
			timestampMs: Date.now(),
			sessionId,
			toolCallId: "big-tool",
			toolName: "Read",
			backendData: { output: "x".repeat(OVERSIZED_BYTES) },
		},
	};
}

describe("a frame over the link's message limit", () => {
	test("nothing that large reaches a link socket: it is answered with response_too_large", async () => {
		const client = await connectUnixWs(socketPath, DEVICE_HEADERS);
		try {
			bridge.server.broadcast(oversizedEvent("oversized-session"));
			const refusal = await client.waitFor("error", E2E_TEST_TIMEOUT_MS);

			expect(refusal).toMatchObject({
				code: RESPONSE_TOO_LARGE_CODE,
				limit: MESSAGE_LIMIT_BYTES,
				message: RESPONSE_TOO_LARGE_MESSAGE,
			});
			expect(refusal.bytes).toBeGreaterThan(MESSAGE_LIMIT_BYTES);
			expect(client.frames().filter((frame) => frame.type === "runtime_event")).toEqual([]);
			expect(logLines.some((line) => line.includes("response_too_large") && line.includes("type=runtime_event"))).toBe(
				true,
			);
		} finally {
			client.close();
		}
	});

	test("a frame under the limit is written untouched", async () => {
		const client = await connectUnixWs(socketPath, DEVICE_HEADERS);
		try {
			bridge.server.broadcast({
				type: "runtime_event",
				backend: "pi",
				data: {
					type: "tool_started",
					backend: "pi",
					timestampMs: Date.now(),
					sessionId: "small-session",
					toolCallId: "small-tool",
					backendData: { output: "y".repeat(1024) },
				},
			});
			const delivered = await client.waitFor("runtime_event", E2E_TEST_TIMEOUT_MS);
			const data = delivered.data as { sessionId: string };
			expect(data.sessionId).toBe("small-session");
		} finally {
			client.close();
		}
	});

	test("a network socket on the same bridge still gets the whole frame", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			await client.messages.waitFor("status");
			bridge.server.broadcast(oversizedEvent("network-session"));

			const delivered = await client.messages.waitFor("runtime_event");
			const data = delivered.data as { sessionId: string; backendData?: { output?: string } };
			expect(data.sessionId).toBe("network-session");
			expect(data.backendData?.output).toHaveLength(OVERSIZED_BYTES);
		} finally {
			client.ws.close();
		}
	});
});
