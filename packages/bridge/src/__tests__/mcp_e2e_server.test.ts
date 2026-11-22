/**
 * The bridge's MCP server in a running bridge: an agent's `broski_ask` and `broski_notify` reach a phone attached to
 * the session over the link socket, through the loopback listener's `/mcp`, behind the session's own token.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { InteractionReply, SessionRef } from "../contract";
import { McpSessionRegistry } from "../mcp";
import { type BridgeMcp, createBridgeMcp, type McpLease } from "../server/bridge-mcp";
import { createHookIngress } from "../server/hook-ingress";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type CoreBridge, removeRoot, startCoreBridge } from "./helpers/core-bridge";
import type { LinkContractClient } from "./helpers/link-contract-client";
import { fetchFrom } from "./helpers/remote-fetch";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) removeRoot(root);
});

interface Running {
	readonly rig: CoreBridge;
	readonly mcp: BridgeMcp;
	readonly registry: McpSessionRegistry;
	readonly phone: LinkContractClient;
	readonly session: SessionRef;
	readonly lease: McpLease;
}

async function running(): Promise<Running> {
	const registry = new McpSessionRegistry();
	const mcp = createBridgeMcp({ version: "0.0.0-e2e", notify: true, registry, heartbeatMs: 25 });
	const rig = await startCoreBridge({ server: { mcp } });
	roots.push(rig.root);
	const phone = await rig.phone("phone");
	const session = rig.fake.fake.seed({ cwd: rig.cwd });
	await phone.ok("session.attach", { session });
	const lease = mcp.issuer("pi").issue(session.sessionId, { ask: true, plan: false, notify: true });
	if (lease === undefined) throw new Error("no lease once the bridge listens");
	return { rig, mcp, registry, phone, session, lease };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
		body: JSON.stringify(body),
	});
}

function call(lease: McpLease, id: number, name: string, args: unknown, progressToken?: string): Promise<Response> {
	const params = { name, arguments: args, ...(progressToken !== undefined && { _meta: { progressToken } }) };
	return post(lease.url, { jsonrpc: "2.0", id, method: "tools/call", params }, bearer(lease.token));
}

function bearer(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}

function sseMessages(text: string): Array<Record<string, unknown>> {
	return text
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice("data: ".length)));
}

const ASK = {
	title: "Pick a store",
	questions: [{ id: "store", text: "Which store?", options: [{ label: "Postgres" }, { label: "SQLite" }] }],
};

describe("the bridge's MCP server in a running bridge", () => {
	test(
		"answers only the session's own token, from this machine",
		async () => {
			const { rig, lease } = await running();
			try {
				const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
				expect(lease.url).toBe(`http://127.0.0.1:${rig.bridge.port}/mcp`);
				expect((await post(lease.url, list)).status).toBe(401);
				expect((await post(lease.url, list, bearer("f".repeat(64)))).status).toBe(401);
				expect((await post(lease.url, list, bearer(rig.bridge.token))).status).toBe(401);
				const foreign = await post(lease.url, list, { ...bearer(lease.token), origin: "https://evil.example" });
				expect(foreign.status).toBe(403);
				const listed = await post(lease.url, list, bearer(lease.token));
				expect(listed.status).toBe(200);
				const names = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
				expect(names).toEqual(["broski_ask", "broski_notify"]);
			} finally {
				await rig.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);

	test("refuses `/mcp` from another machine before its token is read", async () => {
		let reached = 0;
		const remote = fetchFrom("192.168.1.20", {
			hookIngress: createHookIngress(new Map()),
			handleMcp: async () => {
				reached += 1;
				return new Response(null, { status: 202 });
			},
		});
		const request = new Request("https://127.0.0.1:18274/mcp", { method: "POST", headers: bearer("a".repeat(64)) });
		expect((await remote(request))?.status).toBe(403);
		expect(reached).toBe(0);
	});

	test(
		"`broski_ask` waits on the phone's answer over an event stream that keeps the call alive",
		async () => {
			const { rig, phone, session, lease } = await running();
			try {
				const response = await call(lease, 7, "broski_ask", ASK, "ask-1");
				expect(response.headers.get("content-type")).toBe("text/event-stream");
				let ended = false;
				const body = response.text().finally(() => {
					ended = true;
				});
				const requested = await phone.waitForEvent(
					session,
					(envelope) => envelope.event.type === "interaction_requested",
					"the ask on the phone",
				);
				if (requested.event.type !== "interaction_requested") throw new Error("not an ask");
				expect(requested.event.interaction.title).toBe("Pick a store");
				await Bun.sleep(150);
				expect(ended).toBe(false);
				const reply: InteractionReply = { kind: "questions", answers: [{ questionId: "store", selected: ["SQLite"] }] };
				const answer = { interactionId: requested.event.interaction.id, reply };
				expect((await phone.ok("interaction.answer", { session, answer })).result.status).toBe("accepted");
				const messages = sseMessages(await body);
				expect(messages.some((message) => message.method === "notifications/progress")).toBe(true);
				expect(messages.at(-1)).toMatchObject({
					id: 7,
					result: {
						isError: false,
						structuredContent: { status: "answered", answers: [{ id: "store", selected: ["SQLite"] }] },
					},
				});
			} finally {
				await rig.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);

	test(
		"`broski_notify` puts a notice on the phone's stream at once",
		async () => {
			const { rig, phone, session, lease } = await running();
			try {
				const response = await call(lease, 3, "broski_notify", { title: "Tests pass", body: "All 12." });
				expect(await response.json()).toMatchObject({ id: 3, result: { structuredContent: { sent: true } } });
				const notice = await phone.waitForEvent(session, (envelope) => envelope.event.type === "notice", "notice");
				expect(notice.event).toEqual({ type: "notice", level: "info", text: "Tests pass\nAll 12." });
			} finally {
				await rig.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);

	test(
		"a revoked token is refused at once, and stopping the bridge revokes every token",
		async () => {
			const { rig, mcp, registry, session, lease } = await running();
			const other = mcp.issuer("pi").issue(session.sessionId, { ask: false, plan: false, notify: true });
			try {
				expect((await call(lease, 1, "broski_notify", { title: "Before" })).status).toBe(200);
				lease.revoke();
				expect((await call(lease, 2, "broski_notify", { title: "After" })).status).toBe(401);
				expect(registry.size).toBe(1);
				expect(other?.tools).toEqual(["notify"]);
			} finally {
				await rig.stop();
			}
			expect(registry.size).toBe(0);
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
