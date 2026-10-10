/**
 * Pi Durable's half of the decision path, applied by the real applier over the real handler on a
 * faux-backed host. The socket-level delivery is covered by link-feed-decision.test.ts; a durable
 * session is not reachable through the bridge's own host, which needs the user's model credentials.
 */

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ServerWebSocket } from "bun";
import * as piDurable from "../handlers/pi_durable";
import { RouteRegistry } from "../routing/registry";
import type { ServerDeps } from "../routing/types";
import { createLinkDecisionApplier, type LinkDecisionApplier } from "../server/link-feed/decision";
import { LinkFeedRequests } from "../server/link-feed/requests";
import {
	createHarness,
	createSession,
	faux,
	type Harness,
	permissionRequests,
	send,
	transcriptOf,
	waitFor,
} from "./pi_durable/handler_harness";

setDefaultTimeout(30_000);

const fakeFeed = { send: () => 0 } as unknown as ServerWebSocket<unknown>;

/** The registered handler reads only `ctx.reply`; the rest of the context it is spread from is unused. */
const UNUSED_SERVER_DEPS = {} as unknown as ServerDeps;

const BASH_TURN = [
	fauxAssistantMessage([fauxToolCall("bash", { command: "echo decision" }, { id: "call-dec" })], {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage("DONE.", { stopReason: "stop" }),
];

async function pendingRequest(harness: Harness): Promise<{ sessionId: string; requestId: string }> {
	faux.setResponses(BASH_TURN);
	const sessionId = await createSession(harness);
	await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
	await send(harness, { type: "pd_chat", sessionId, content: "run it", requestId: "pd-dec" });
	await waitFor(() => permissionRequests(harness).length > 0, "the permission request");
	return { sessionId, requestId: permissionRequests(harness)[0]?.requestId ?? "" };
}

function durableApplier(harness: Harness, sessionId: string, requestId: string): LinkDecisionApplier {
	const registry = new RouteRegistry();
	registry.register("pd_permission_response", async (message, ctx) => {
		await piDurable.handle(harness.socket, message, ctx.reply, harness.deps);
	});
	const requests = new LinkFeedRequests();
	requests.announce("pi-durable", sessionId, requestId, { kind: "approval" });
	return createLinkDecisionApplier({ registry, serverDeps: UNUSED_SERVER_DEPS, requests });
}

describe("pi-durable decisions", () => {
	test("allow resolves the pending permission and the tool runs", async () => {
		const harness = createHarness();
		try {
			const { sessionId, requestId } = await pendingRequest(harness);
			expect(requestId).toBe(`${sessionId}:call-dec`);
			expect(harness.host.permissions.pendingFor(sessionId)).toHaveLength(1);

			const apply = durableApplier(harness, sessionId, requestId);
			expect(
				await apply({ backend: "pi-durable", session: sessionId, request: requestId, decision: "allow" }, fakeFeed),
			).toEqual({ ok: true, error: null });
			expect(harness.host.permissions.pendingFor(sessionId)).toEqual([]);

			await waitFor(async () => {
				await send(harness, { type: "pd_get_transcript", sessionId });
				return transcriptOf(harness).some((message) => message.role === "toolResult" && message.isError === false);
			}, "the tool result");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("deny resolves the pending permission and the tool is blocked", async () => {
		const harness = createHarness();
		try {
			const { sessionId, requestId } = await pendingRequest(harness);

			const apply = durableApplier(harness, sessionId, requestId);
			expect(
				await apply({ backend: "pi-durable", session: sessionId, request: requestId, decision: "deny" }, fakeFeed),
			).toEqual({ ok: true, error: null });
			expect(harness.host.permissions.pendingFor(sessionId)).toEqual([]);

			await waitFor(async () => {
				await send(harness, { type: "pd_get_transcript", sessionId });
				return transcriptOf(harness).some((message) => message.role === "toolResult" && message.isError === true);
			}, "the blocked result");
		} finally {
			await harness.host.closeAll();
		}
	});
});
