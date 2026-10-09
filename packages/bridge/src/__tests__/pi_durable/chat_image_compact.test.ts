import { describe, expect, test } from "bun:test";
import type { AssistantMessage, ImageContent, Message } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationId, EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { piDurableContextTokens } from "../../runtime/pi-durable-runtime-read-models";
import { createHarness, createSession, faux, requireMessage, runtimeStates, send, waitFor } from "./handler_harness";

const PNG_BASE64 = Buffer.from("not-a-real-png").toString("base64");

let entryId = 0;

function entry(kind: string, model: Message[]): EntryRecord {
	entryId += 1;
	return { id: entryId as EntryId, conversationId: 1 as ConversationId, kind, model };
}

function assistant(usage: { input: number; output: number; cacheRead: number; cacheWrite: number }): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "faux",
		provider: "faux",
		model: "faux-1",
		usage: {
			...usage,
			totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function userImageBlocks(entries: readonly EntryRecord[]): ImageContent[] {
	const blocks: ImageContent[] = [];
	for (const item of entries) {
		for (const message of item.model ?? []) {
			if (message.role !== "user" || typeof message.content === "string") continue;
			for (const block of message.content) {
				if (block.type === "image") blocks.push(block);
			}
		}
	}
	return blocks;
}

describe("pi-durable pd_chat images", () => {
	test("submits text and an image as one user entry", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			faux.setResponses([fauxAssistantMessage("SEEN", { stopReason: "stop" })]);

			await send(harness, {
				type: "pd_chat",
				sessionId,
				content: "what is in this image",
				images: [{ data: PNG_BASE64, mimeType: "image/png" }],
				requestId: "chat-image",
			});
			expect(requireMessage(harness, "pd_chat_accepted").requestId).toBe("chat-image");

			const page = await harness.host.transcript(sessionId);
			const images = userImageBlocks(page.entries);
			expect(images).toHaveLength(1);
			expect(images[0]).toEqual({ type: "image", data: PNG_BASE64, mimeType: "image/png" });

			const text = page.entries
				.flatMap((item) => item.model ?? [])
				.flatMap((message) => {
					if (message.role !== "user" || typeof message.content === "string") return [];
					return message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
				});
			expect(text).toContain("what is in this image");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("accepts an image-only prompt and rejects unknown types and empty input", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);

			await send(harness, {
				type: "pd_chat",
				sessionId,
				content: "",
				images: [{ data: PNG_BASE64, mimeType: "image/png" }],
				requestId: "image-only",
			});
			expect(requireMessage(harness, "pd_chat_accepted").requestId).toBe("image-only");

			await send(harness, {
				type: "pd_chat",
				sessionId,
				content: "nope",
				images: [{ data: PNG_BASE64, mimeType: "image/tiff" }],
				requestId: "bad-mime",
			});
			const mimeError = requireMessage(harness, "error");
			expect(mimeError.requestId).toBe("bad-mime");
			expect(mimeError.message).toContain("mimeType");

			await send(harness, { type: "pd_chat", sessionId, content: "   ", requestId: "empty" });
			expect(requireMessage(harness, "error").requestId).toBe("empty");
		} finally {
			await harness.host.closeAll();
		}
	});

	test("publishes the newest answer's prompt tokens as contextTokens", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });
			faux.setResponses([fauxAssistantMessage("COUNTED", { stopReason: "stop" })]);

			await send(harness, { type: "pd_chat", sessionId, content: "count", requestId: "chat-count" });
			await waitFor(
				() => Number(runtimeStates(harness).at(-1)?.backendData?.contextTokens ?? 0) > 0,
				"the context tokens in runtime_state",
			);
		} finally {
			await harness.host.closeAll();
		}
	});
});

describe("pi-durable context tokens", () => {
	test("reads the prompt size off the newest assistant entry", () => {
		const entries = [
			entry("pi.user", [{ role: "user", content: "hi", timestamp: 1 }]),
			entry("pi.assistant", [assistant({ input: 100, output: 7, cacheRead: 40, cacheWrite: 10 })]),
			entry("pi.user", [{ role: "user", content: "again", timestamp: 2 }]),
		];
		expect(piDurableContextTokens(entries)).toBe(150);
	});

	test("is undefined until the first answer commits", () => {
		expect(piDurableContextTokens([])).toBeUndefined();
		expect(piDurableContextTokens([entry("pi.user", [{ role: "user", content: "hi", timestamp: 1 }])])).toBeUndefined();
	});
});

describe("pi-durable pd_compact", () => {
	test("admits compaction on an open session and refuses a closed one", async () => {
		const harness = createHarness();
		try {
			const sessionId = await createSession(harness);
			faux.setResponses([fauxAssistantMessage("OK", { stopReason: "stop" })]);
			await send(harness, { type: "pd_chat", sessionId, content: "seed", requestId: "seed" });
			await send(harness, { type: "set_view", agent: "pi-durable", sessionId });

			await send(harness, { type: "pd_compact", sessionId, requestId: "compact-1" });
			const compacted = requireMessage(harness, "pd_compacted");
			expect(compacted.requestId).toBe("compact-1");
			expect(compacted.data).toBe(true);

			await waitFor(async () => (await harness.host.inspect(sessionId)).tasks.length === 0, "the compaction to settle");

			await send(harness, { type: "pd_compact", sessionId: "does-not-exist", requestId: "compact-2" });
			expect(requireMessage(harness, "pd_compacted").data).toBe(false);
		} finally {
			await harness.host.closeAll();
		}
	});

	test("errors when the session id is missing", async () => {
		const harness = createHarness();
		try {
			await send(harness, { type: "pd_compact", requestId: "compact-3" });
			expect(requireMessage(harness, "error").message).toContain("sessionId is required");
		} finally {
			await harness.host.closeAll();
		}
	});
});
