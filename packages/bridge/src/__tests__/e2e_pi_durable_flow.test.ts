/**
 * End-to-end Pi Durable flow with the faux model, driven through the handler entry point (the WS
 * transport is covered by the pi_durable handler tests). Create a session, attach a view, run a
 * turn that needs approval, approve it, and read the committed transcript.
 */

import { describe, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createHarness,
	createSession,
	faux,
	permissionRequests,
	requireMessage,
	runtimeEventTypes,
	runtimeStates,
	send,
	transcriptOf,
	waitFor,
} from "./pi_durable/handler_harness";

describe("e2e pi-durable create/chat/permission flow", () => {
	test("approves a bash tool call and commits the answer to the transcript", async () => {
		const harness = createHarness();
		try {
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "echo e2e > out.txt" }, { id: "call-e2e" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);

			const sessionId = await createSession(harness);

			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			expect(runtimeStates(harness).at(-1)?.sessionId).toBe(sessionId);

			await send(harness, { type: "pd_chat", sessionId, content: "write the file", requestId: "e2e-chat" });
			expect(requireMessage(harness, "pd_chat_accepted").requestId).toBe("e2e-chat");

			await waitFor(() => permissionRequests(harness).length > 0, "the permission request");
			const request = permissionRequests(harness)[0];
			expect(request?.kind).toBe("bash");
			expect(request?.options).toEqual(["allow", "deny"]);

			await send(harness, {
				type: "pd_permission_response",
				sessionId,
				requestId: request?.requestId,
				decision: "allow",
			});
			expect(requireMessage(harness, "pd_permission_resolved").data).toBe(true);

			await waitFor(async () => {
				await send(harness, { type: "pd_get_transcript", sessionId });
				return transcriptOf(harness).some((message) => message.role === "assistant" && message.text === "DONE.");
			}, "the committed answer");
			await waitFor(() => runtimeStates(harness).at(-1)?.isStreaming === false, "the idle state");

			const types = runtimeEventTypes(harness);
			expect(types).toContain("agent_started");
			expect(types).toContain("permission_requested");
			expect(types).toContain("tool_started");
			expect(types).toContain("tool_finished");
			expect(types).toContain("agent_finished");
		} finally {
			await harness.host.closeAll();
		}
	});
});
