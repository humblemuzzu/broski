/**
 * The store as the rest of the adapter sees it (`createSessionStore`), with the real entry mapping: what
 * a session Pi wrote reads as, attachments, and the pieces wired together.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import type { LiveOverlay, SessionStore } from "../../backends/pi/ports";
import { createSessionStore } from "../../backends/pi/store/session-store";
import {
	AttachmentReadResult,
	type CatalogEvent,
	MAX_IMAGE_CHARS,
	type TranscriptItem,
	TranscriptReadResult,
} from "../../contract";
import { hostSpikeSession, spikeRuntimeFactory } from "./helpers/pi-spike";
import { createPiTestEnv, createTestModelRuntime, type PiTestEnv, registerFaux } from "./helpers/pi-test-env";
import { imageBlock, SessionBuilder, textBlock, toolCall, writeSession } from "./store_fixtures";

setDefaultTimeout(15_000);

let env: PiTestEnv;
let events: CatalogEvent[];
let store: SessionStore;

const NOBODY: LiveOverlay = { row: () => undefined };
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeEach(() => {
	env = createPiTestEnv();
	events = [];
	store = createSessionStore({
		agentDir: env.agentDir,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		now: () => Date.parse("2026-03-02T00:00:00.000Z"),
	});
});

afterEach(() => {
	store.dispose();
	env.dispose();
});

async function transcript(id: string, limit = 200): Promise<TranscriptItem[]> {
	const result = await store.transcript(id, { limit }, NOBODY);
	expect(TranscriptReadResult.safeParse(result).success).toBe(true);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page.items;
}

describe("a session Pi wrote, read through the store", () => {
	test("a real run with a write tool reads back with its file change, however the pages are cut", async () => {
		const modelRuntime = await createTestModelRuntime(env);
		const faux = await registerFaux(modelRuntime, [{ id: "faux-1" }]);
		const runtime = await hostSpikeSession(env, spikeRuntimeFactory(modelRuntime, faux.handle.getModel(), []));
		faux.handle.setResponses([
			fauxAssistantMessage([fauxText("Writing."), fauxToolCall("write", { path: "notes.txt", content: "hello" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxText("Done."), { stopReason: "stop" }),
		]);
		await runtime.session.prompt("write the notes");
		const sessionId = runtime.session.sessionId;
		await runtime.dispose();

		for (const limit of [200, 1]) {
			const items: TranscriptItem[] = [];
			let cursor: string | undefined;
			do {
				const result = await store.transcript(sessionId, { limit, ...(cursor !== undefined && { cursor }) }, NOBODY);
				if (result.status === "rejected") throw new Error(result.rejection.message);
				items.push(...result.page.items);
				cursor = result.page.nextCursor;
			} while (cursor !== undefined);

			const call = items.find((item) => item.kind === "tool_call");
			const result = items.find((item) => item.kind === "tool_result");
			expect(call?.kind === "tool_call" && call.name).toBe("write");
			expect(result?.kind === "tool_result" && result.toolCallId).toBe(
				call?.kind === "tool_call" ? call.toolCallId : "missing",
			);
			expect(result?.kind === "tool_result" && result.result.fileChanges).toEqual([
				{ path: "notes.txt", change: "modified", additions: 1 },
			]);
		}
	});

	test("a stored write is paired with its own call by id within the branch, so each result carries its own file change", async () => {
		const builder = new SessionBuilder({ id: "w1", cwd: env.cwd, version: 3 });
		builder.user("go", 10);
		builder.assistant(
			[
				toolCall("t1", "write", { path: "a.txt", content: "x" }),
				toolCall("t2", "write", { path: "b.txt", content: "y" }),
			],
			20,
		);
		builder.toolResult("t2", "wrote b", 30, "write");
		builder.toolResult("t1", "wrote a", 31, "write");
		writeSession(env.sessionDir, builder);

		const results = (await transcript("w1")).filter((item) => item.kind === "tool_result");

		expect(
			results.map((item) => (item.kind === "tool_result" ? item.result.fileChanges.map((change) => change.path) : [])),
		).toEqual([["a.txt"], ["b.txt"]]);
	});

	test("the store lists, finds, renames and forks what it reads", async () => {
		const builder = new SessionBuilder({ id: "s1", cwd: env.cwd, version: 3 });
		builder.user("first", 10);
		builder.assistant([textBlock("one")], 20);
		const path = writeSession(env.sessionDir, builder);

		const listed = await store.list({ cwd: env.cwd, archived: false }, { limit: 10 }, NOBODY);
		expect(listed.status === "accepted" && listed.page.items.map((row) => row.session.sessionId)).toEqual(["s1"]);
		expect(await store.locate("s1")).toEqual({ sessionId: "s1", path, cwd: env.cwd, origin: "external" });
		expect(await store.locate("nobody")).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(store.sessionDirFor(env.cwd)).toBe(env.sessionDir);

		expect(await store.rename("s1", "Better")).toEqual({ status: "accepted" });
		const found = await store.get("s1", NOBODY);
		expect(found.status === "accepted" && found.summary.title).toEqual({ text: "Better", source: "user" });

		const forked = await store.fork("s1", { itemId: "e0000001:0", position: "through" }, NOBODY);
		if (forked.status === "rejected") throw new Error(forked.rejection.message);
		expect(await transcript(forked.session.sessionId)).toHaveLength(1);
		const located = await store.locate(forked.session.sessionId);
		expect("origin" in located && located.origin).toBe("broski");
		expect(await store.entryOf("s1", "e0000002:0", NOBODY)).toBe("e0000002");
	});

	test("watching through the store reports a file another process writes, and goes quiet at dispose", async () => {
		store.watch(NOBODY);
		await store.list({ archived: false }, { limit: 10 }, NOBODY);
		await Bun.sleep(300);

		writeSession(env.sessionDir, chatOf("outside"));
		const deadline = Date.now() + 5_000;
		while (!events.some((event) => event.type === "session_updated") && Date.now() < deadline) await Bun.sleep(20);
		expect(
			events.some((event) => event.type === "session_updated" && event.summary.session.sessionId === "outside"),
		).toBe(true);

		store.dispose();
		store.dispose();
		const seen = events.length;
		writeSession(env.sessionDir, chatOf("after-dispose"));
		await Bun.sleep(600);
		expect(events).toHaveLength(seen);
	});
});

function chatOf(id: string): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: "/somewhere", version: 3 });
	builder.user("hello", 10);
	builder.assistant([textBlock("hi")], 20);
	return builder;
}

describe("reading an image back", () => {
	function imageSession(): void {
		const builder = new SessionBuilder({ id: "img", cwd: env.cwd, version: 3 });
		builder.user([textBlock("look"), imageBlock(PIXEL)], 10);
		builder.assistant([toolCall("c1")], 20);
		builder.raw({
			type: "message",
			id: "e0000099",
			parentId: "e0000002",
			timestamp: "2026-03-01T10:00:30.000Z",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "read",
				content: [{ type: "text", text: "shot" }, imageBlock("QUJD", "image/jpeg")],
				isError: false,
				timestamp: 1,
			},
		});
		builder.raw({
			type: "message",
			id: "e0000098",
			parentId: "e0000099",
			timestamp: "t",
			message: { role: "user", content: [imageBlock("A".repeat(MAX_IMAGE_CHARS + 1))], timestamp: 1 },
		});
		writeSession(env.sessionDir, builder);
	}

	async function read(id: string): Promise<AttachmentReadResult> {
		const result = await store.attachment("img", id);
		expect(AttachmentReadResult.safeParse(result).success).toBe(true);
		return result;
	}

	test("the image of a user message and of a tool result are read by the id the transcript gave", async () => {
		imageSession();

		const items = await transcript("img");
		const user = items.find((item) => item.kind === "user_message" && item.id === "e0000001:0");
		const ref = user?.kind === "user_message" ? user.attachments[0] : undefined;

		expect(ref).toMatchObject({ kind: "image_ref", id: "e0000001:1", mimeType: "image/png" });
		expect(await read("e0000001:1")).toEqual({
			status: "accepted",
			image: { kind: "image", mimeType: "image/png", data: PIXEL },
		});
		expect(await read("e0000099:1")).toEqual({
			status: "accepted",
			image: { kind: "image", mimeType: "image/jpeg", data: "QUJD" },
		});
	});

	test("what is not an image block is not_found, and an image the link cannot carry is a backend_error", async () => {
		imageSession();

		for (const id of ["e0000001:0", "e0000001:7", "e0000002:0", "nope:1", "garbage", "e0000001"]) {
			const result = await read(id);
			expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
		}
		const huge = await read("e0000098:0");
		expect(huge.status === "rejected" && huge.rejection.code).toBe("backend_error");
		const unknown = await store.attachment("nobody", "e0000001:1");
		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
	});
});
