import { describe, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { handle } from "../../handlers/pi_durable";
import type { ServerMessage } from "../../types";
import {
	Collector,
	createHarness,
	createSession,
	faux,
	permissionRequests,
	requireMessage,
	resumedCounts,
	runtimeEventTypes,
	runtimeStates,
	send,
	sendUnified,
	transcriptOf,
	waitFor,
} from "./handler_harness";

const APPROVED_BASH = [
	fauxAssistantMessage([fauxToolCall("bash", { command: "echo approved > out.txt" }, { id: "call-1" })], {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage("DONE.", { stopReason: "stop" }),
];
const BLOCKING_BASH = [
	fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 30" }, { id: "call-busy" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("OK", { stopReason: "stop" }),
];

describe("pi-durable view streaming", () => {
	test("streams a turn to an attached view through an approved permission", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);

			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			const streamed = harness.socket.messages.filter(
				(message) => message.type === "runtime_event" || message.type === "runtime_state",
			);
			expect(streamed[0]?.type).toBe("runtime_event");
			expect(runtimeEventTypes(harness)[0]).toBe("session_state_changed");
			expect(runtimeStates(harness)).toHaveLength(1);
			expect(runtimeStates(harness)[0]?.isStreaming).toBe(false);
			expect(runtimeStates(harness)[0]?.sessionId).toBe(sessionId);
			expect(harness.host.isOpen(sessionId)).toBe(true);

			faux.setResponses(APPROVED_BASH);

			await send(harness, { type: "pd_chat", sessionId, content: "write the file", requestId: "chat-1" });
			const accepted = requireMessage(harness, "pd_chat_accepted");
			expect(accepted.requestId).toBe("chat-1");
			expect(typeof accepted.data.submissionId).toBe("number");

			await waitFor(() => permissionRequests(harness).length > 0, "the permission request");
			const request = permissionRequests(harness)[0];
			expect(request?.requestId).toBe(`${sessionId}:call-1`);
			expect(request?.kind).toBe("bash");
			expect(request?.title).toBe("Run: echo approved > out.txt");
			expect(request?.options).toEqual(["allow", "deny"]);
			expect(request?.metadata).toMatchObject({ tool: "bash", sessionId });

			expect(harness.host.permissions.pendingFor(sessionId)).toHaveLength(1);
			await send(harness, {
				type: "pd_permission_response",
				sessionId,
				requestId: `${sessionId}:call-1`,
				decision: "allow",
			});
			expect(requireMessage(harness, "pd_permission_resolved").data).toBe(true);
			expect(harness.host.permissions.pendingFor(sessionId)).toEqual([]);

			await waitFor(async () => {
				await send(harness, { type: "pd_get_transcript", sessionId });
				return transcriptOf(harness).some((message) => message.role === "assistant" && message.text === "DONE.");
			}, "the committed answer");
			await waitFor(() => runtimeStates(harness).at(-1)?.isStreaming === false, "the idle state");
			expect(runtimeStates(harness).length).toBeGreaterThan(1);
			expect(runtimeStates(harness).some((state) => Number(state.backendData?.entryCount ?? 0) > 0)).toBe(true);

			const types = runtimeEventTypes(harness);
			expect(types).toContain("agent_started");
			expect(types).toContain("assistant_text_delta");
			expect(types).toContain("tool_started");
			expect(types).toContain("tool_finished");
			expect(types).toContain("agent_finished");

			const messages = transcriptOf(harness);
			expect(messages.some((message) => message.role === "user" && message.content === "write the file")).toBe(true);
			expect(messages.some((message) => message.role === "toolResult" && message.isError === false)).toBe(true);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("treats a repeated requestId as exactly-once, steers a busy session and aborts it", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });

			faux.setResponses(BLOCKING_BASH);

			await send(harness, { type: "pd_chat", sessionId, content: "run it", requestId: "chat-once" });
			const first = requireMessage(harness, "pd_chat_accepted").data.submissionId;
			await send(harness, { type: "pd_chat", sessionId, content: "run it", requestId: "chat-once" });
			expect(requireMessage(harness, "pd_chat_accepted").data.submissionId).toBe(first);

			await waitFor(() => permissionRequests(harness).length > 0, "the permission request");
			await send(harness, {
				type: "pd_permission_response",
				sessionId,
				requestId: permissionRequests(harness)[0]?.requestId ?? "",
				decision: "allow",
			});
			await waitFor(() => runtimeEventTypes(harness).includes("tool_started"), "the tool start");

			await sendUnified(harness, { type: "unified_delete_session", backend: "pi-durable", sessionId });
			expect(requireMessage(harness, "unified_session_deleted").data).toBe(false);

			await send(harness, {
				type: "pd_chat",
				sessionId,
				content: "also say STEERED",
				requestId: "chat-steer",
				whenBusy: "steer",
			});
			expect(requireMessage(harness, "pd_chat_accepted").data.submissionId).not.toBe(first);

			await send(harness, { type: "pd_get_transcript", sessionId });
			expect(transcriptOf(harness).filter((message) => message.role === "user")).toHaveLength(1);

			await sendUnified(harness, { type: "unified_abort", backend: "pi-durable", sessionId });
			expect(requireMessage(harness, "unified_aborted").data).toBe(true);
			await waitFor(async () => (await harness.host.inspect(sessionId)).tasks.length === 0, "an idle harness");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("sets a model and thinking level, and refuses an unknown model or session", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);

			await sendUnified(harness, {
				type: "unified_set_model",
				backend: "pi-durable",
				sessionId,
				provider: "nope",
				modelId: "x",
			});
			expect(requireMessage(harness, "unified_model_set").data).toBe(false);

			await sendUnified(harness, {
				type: "unified_set_model",
				backend: "pi-durable",
				sessionId,
				model: "faux/faux-1",
				thinkingLevel: "high",
			});
			expect(requireMessage(harness, "unified_model_set").data).toBe(true);
			expect((await harness.host.store.read(sessionId))?.thinkingLevel).toBe("high");

			await send(harness, { type: "pd_get_transcript", sessionId: "does-not-exist", requestId: "t-2" });
			expect(requireMessage(harness, "error").requestId).toBe("t-2");

			await sendUnified(harness, { type: "unified_abort", backend: "pi-durable", sessionId: "does-not-exist" });
			expect(requireMessage(harness, "unified_aborted").data).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("detaches on switch-away so the idle host closes the session", async () => {
		const harness = createHarness({ idleTimeoutMs: 150 });
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			expect(harness.host.isOpen(sessionId)).toBe(true);

			await send(harness, { type: "set_view", agent: "claude-code", sessionId: "cc-1" });
			await waitFor(() => !harness.host.isOpen(sessionId), "the idle close after switch-away");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("replays the attach snapshot and a pending permission on reconnect", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });

			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("write", { path: "out.txt", content: "PROCEED" }, { id: "call-wait" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);
			await send(harness, { type: "pd_chat", sessionId, content: "write it", requestId: "chat-wait" });
			await waitFor(() => permissionRequests(harness).length > 0, "the permission request");

			const phone = new Collector();
			const reply = (message: ServerMessage) => {
				phone.messages.push(message);
			};
			await handle(phone, { type: "set_view", agent: "pi-durable", sessionId }, reply, harness.deps);
			await handle(
				phone,
				{ type: "pd_permission_response", sessionId, requestId: `${sessionId}:call-wait`, decision: "deny" },
				reply,
				harness.deps,
			);

			const phoneEvents = phone.messages.flatMap((message) => (message.type === "runtime_event" ? [message.data] : []));
			expect(phoneEvents[0]?.type).toBe("session_state_changed");
			const replayed = phoneEvents.filter((event) => event.type === "permission_requested");
			expect(replayed).toHaveLength(1);
			expect(replayed[0]?.request.requestId).toBe(`${sessionId}:call-wait`);
			expect(replayed[0]?.replayed).toBe(true);
			expect(phone.messages.some((message) => message.type === "runtime_state")).toBe(true);
			expect(phone.messages.find((message) => message.type === "pd_permission_resolved")).toMatchObject({
				type: "pd_permission_resolved",
				data: true,
			});
		} finally {
			await harness.host.closeAll();
		}
	});

	test("reports interrupted work as a resumed backend event", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });

			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("bash", { command: "sleep 2" }, { id: "call-crash" })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("DONE.", { stopReason: "stop" }),
			]);
			await send(harness, { type: "pd_chat", sessionId, content: "sleep", requestId: "chat-crash" });
			await waitFor(() => permissionRequests(harness).length > 0, "the permission request");
			await send(harness, {
				type: "pd_permission_response",
				sessionId,
				requestId: permissionRequests(harness)[0]?.requestId ?? "",
				decision: "allow",
			});
			await waitFor(() => runtimeEventTypes(harness).includes("tool_started"), "the tool start");

			await send(harness, { type: "set_view", agent: "claude-code", sessionId: "cc-1" });
			await harness.host.close(sessionId);

			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			const resumed = harness.socket.messages.flatMap((message) =>
				message.type === "runtime_event" && message.data.type === "backend_event" && message.data.kind === "resumed"
					? [message.data]
					: [],
			);
			expect(resumed).toHaveLength(1);
			const counts = resumed[0] === undefined ? { tasks: 0, submissions: 0 } : resumedCounts(resumed[0]);
			expect(counts.tasks).toBeGreaterThan(0);
			expect(counts.submissions).toBeGreaterThanOrEqual(0);
		} finally {
			await harness.host.closeAll();
		}
	});
});
