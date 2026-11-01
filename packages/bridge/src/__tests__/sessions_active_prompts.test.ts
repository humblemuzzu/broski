/**
 * `sessions_active` is what a reconnecting phone gets: everything the bridge still holds. Beyond the
 * ids, that means the prompts themselves — the Claude Code elicitation with its real server and URL,
 * and the Pi extension-UI dialogs.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { pendingElicitations } from "../server/pending-elicitation";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type DecisionHarness, startDecisionHarness } from "./link/decision-harness";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const DEVICE_HEADERS = { "x-broski-device-id": "0123456789abcdef0123456789abcdef", "x-broski-role": "owner" };

let h: DecisionHarness;

beforeAll(async () => {
	pendingElicitations.reset();
	h = await startDecisionHarness();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await h.stop();
	pendingElicitations.reset();
});

async function sessionsActive(client: UnixWsClient): Promise<Record<string, unknown>> {
	client.send({
		type: "register_device",
		deviceId: "0123456789abcdef0123456789abcdef",
		deviceName: "Test Phone",
		platform: "ios",
		requestId: "register-1",
	});
	const reply = await client.waitForWhere((frame) => frame.type === "sessions_active", "sessions_active");
	return ((reply.data as Record<string, unknown>)?.pendingPermissions ?? {}) as Record<string, unknown>;
}

async function withRegisteredClient<T>(work: (client: UnixWsClient) => Promise<T>): Promise<T> {
	const client = await connectUnixWs(h.socketPath, DEVICE_HEADERS);
	try {
		return await work(client);
	} finally {
		client.close();
	}
}

describe("sessions_active after a reconnect", () => {
	test("carries nothing for a prompt it never saw", async () => {
		const pending = await withRegisteredClient(sessionsActive);
		expect(pending.pi).toBeUndefined();
		expect(pending.claudeCodeElicitations ?? []).toHaveLength(0);
	});
});

describe("a Claude Code elicitation", () => {
	test("is kept with the server, message and url it asked about", () => {
		pendingElicitations.remember({
			sessionId: "cc-1",
			requestId: "elic-1",
			mcpServerName: "linear",
			message: "Authorise Linear",
			mode: "url",
			url: "https://linear.example/authorize",
			at: Date.now(),
		});

		expect(pendingElicitations.pending()).toEqual([
			expect.objectContaining({ sessionId: "cc-1", requestId: "elic-1", mcpServerName: "linear" }),
		]);

		pendingElicitations.forget("cc-1", "elic-1");
		expect(pendingElicitations.pending()).toHaveLength(0);
	});
});
