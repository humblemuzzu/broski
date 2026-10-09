import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	createHarness,
	createSession,
	faux,
	MODEL,
	requireMessage,
	send,
	sendUnified,
	transcriptOf,
	waitFor,
} from "./handler_harness";

describe("pi-durable session operations", () => {
	test("creates, lists, reads the transcript of and deletes a session", async () => {
		const harness = createHarness();
		try {
			await send(harness, {
				type: "pd_create_session",
				cwd: harness.projectDir,
				model: MODEL,
				thinkingLevel: "low",
				title: "First",
				requestId: "create-1",
			});
			const created = requireMessage(harness, "pd_session_created");
			expect(created.requestId).toBe("create-1");
			expect(created.data.backend).toBe("pi-durable");
			expect(created.data.title).toBe("First");
			expect(created.data.cwd).toBe(harness.projectDir);
			expect(created.data.modelLabel).toBe("faux/faux-1");
			expect(created.data.sessionKind).toBe("root");

			await sendUnified(harness, { type: "unified_list_sessions", backend: "pi-durable", requestId: "list-1" });
			const sessions = requireMessage(harness, "unified_sessions");
			expect(sessions.requestId).toBe("list-1");
			expect(sessions.data).toHaveLength(1);
			expect(sessions.data[0]).toMatchObject({ id: created.data.id, backend: "pi-durable", title: "First" });

			await sendUnified(harness, { type: "unified_list_models", backend: "pi-durable" });
			expect(requireMessage(harness, "unified_models").data).toEqual([
				{
					id: "faux-1",
					backend: "pi-durable",
					label: "faux/faux-1",
					providerId: "faux",
					contextWindow: 0,
					supportsReasoning: false,
					supportsTools: true,
				},
			]);

			await sendUnified(harness, { type: "unified_list_projects", backend: "pi-durable" });
			expect(requireMessage(harness, "unified_projects").data).toEqual([
				{ id: harness.projectDir, name: basename(harness.projectDir), path: harness.projectDir },
			]);

			await send(harness, { type: "pd_get_transcript", sessionId: created.data.id, requestId: "t-1" });
			expect(requireMessage(harness, "pd_transcript").requestId).toBe("t-1");
			expect(transcriptOf(harness)).toEqual([]);

			await send(harness, {
				type: "pd_create_session",
				cwd: harness.projectDir,
				model: { provider: "nope", modelId: "x" },
			});
			expect(requireMessage(harness, "error").message).toContain("unknown model nope/x");

			await send(harness, { type: "pd_chat", sessionId: "missing", content: "hi", requestId: "chat-missing" });
			expect(requireMessage(harness, "error").requestId).toBe("chat-missing");

			await sendUnified(harness, {
				type: "unified_delete_session",
				backend: "pi-durable",
				sessionId: created.data.id,
			});
			expect(requireMessage(harness, "unified_session_deleted").data).toBe(true);
			await sendUnified(harness, { type: "unified_list_sessions", backend: "pi-durable" });
			expect(requireMessage(harness, "unified_sessions").data).toEqual([]);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("pages the transcript backwards from the newest entries", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			faux.setResponses([fauxAssistantMessage("PAGED", { stopReason: "stop" })]);
			await send(harness, { type: "pd_chat", sessionId, content: "first question", requestId: "chat-page" });
			await waitFor(async () => {
				await send(harness, { type: "pd_get_transcript", sessionId });
				return transcriptOf(harness).some((message) => message.role === "assistant");
			}, "the committed answer");

			await send(harness, { type: "pd_get_transcript", sessionId, limit: 1 });
			const newestPage = requireMessage(harness, "pd_transcript");
			expect(newestPage.data.messages).toHaveLength(1);
			expect(newestPage.data.messages[0]).toMatchObject({ role: "assistant", text: "PAGED" });
			const cursor = newestPage.data.nextCursor;
			expect(cursor).toBeDefined();

			await send(harness, { type: "pd_get_transcript", sessionId, limit: 5, cursor });
			const older = transcriptOf(harness);
			expect(older.some((message) => message.role === "user" && message.content === "first question")).toBe(true);
			expect(older.some((message) => message.role === "assistant")).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});
});
