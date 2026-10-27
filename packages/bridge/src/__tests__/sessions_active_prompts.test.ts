/**
 * `sessions_active` is what a reconnecting phone gets: everything the bridge still holds. Beyond the
 * ids, that means the prompts themselves — an OpenCode approval as the backend asked it, the
 * Claude Code elicitation with its real server and URL, and the Pi extension-UI dialogs.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { pendingElicitations } from "../server/pending-elicitation";
import { pendingPermissions } from "../server/pending-permissions";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type DecisionHarness, startDecisionHarness } from "./link/decision-harness";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const CWD = "/Users/dev/broski";
const DEVICE_HEADERS = { "x-broski-device-id": "0123456789abcdef0123456789abcdef", "x-broski-role": "owner" };

let h: DecisionHarness;

beforeAll(async () => {
	pendingPermissions.reset();
	pendingElicitations.reset();
	h = await startDecisionHarness();
}, E2E_TEST_TIMEOUT_MS);

afterAll(async () => {
	await h.stop();
	pendingPermissions.reset();
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

describe("pending prompts the bridge keeps", () => {
	test("the registries remember a request and forget it when it is answered", () => {
		pendingPermissions.remember({
			type: "permission_requested",
			backend: "opencode",
			timestampMs: Date.now(),
			sessionId: "oc-1",
			request: { requestId: "per_1", kind: "bash" },
		});
		expect(pendingPermissions.pending("opencode")).toHaveLength(1);

		pendingPermissions.forget("opencode", "oc-1", "per_1");
		expect(pendingPermissions.pending("opencode")).toHaveLength(0);
	});

	test("a request without an id or a session is not remembered", () => {
		pendingPermissions.remember({
			type: "permission_requested",
			backend: "opencode",
			timestampMs: Date.now(),
			request: { kind: "bash" },
		});
		pendingPermissions.remember({
			type: "permission_requested",
			backend: "opencode",
			timestampMs: Date.now(),
			sessionId: "oc-1",
			request: {},
		});
		expect(pendingPermissions.pending("opencode")).toHaveLength(0);
	});
});

describe("sessions_active after a reconnect", () => {
	test("carries the OpenCode approval the phone never answered", async () => {
		h.ocStream("permission.asked", { id: "per_1", sessionID: "oc-1", permission: "bash", patterns: ["src/**"] });
		await Bun.sleep(50);

		const pending = await withRegisteredClient(sessionsActive);
		const appros = pending.opencode as Array<Record<string, unknown>>;
		expect(appros).toHaveLength(1);
		expect(appros[0]?.sessionId).toBe("oc-1");
		expect(appros[0]?.requestId).toBe("per_1");
		expect((appros[0]?.request as Record<string, unknown>)?.kind).toBe("bash");
	});

	test("stops carrying it once the phone answers", async () => {
		const client = await connectUnixWs(h.socketPath, DEVICE_HEADERS);
		try {
			client.send({
				type: "permission_response",
				permissionId: "per_1",
				response: "once",
				sessionId: "oc-1",
				requestId: "reply-1",
			});
			await Bun.sleep(80);
		} finally {
			client.close();
		}

		const pending = await withRegisteredClient(sessionsActive);
		expect(pending.opencode ?? []).toHaveLength(0);
	});

	test("carries nothing for a prompt it never saw", async () => {
		const pending = await withRegisteredClient(sessionsActive);
		expect(pending.pi ?? []).toHaveLength(0);
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
