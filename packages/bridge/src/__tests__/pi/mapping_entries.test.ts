/** session entries as transcript items. Every entry type and message role, each output under the contract's schema. */

import { describe, expect, test } from "bun:test";
import type { PromptRecord } from "../../backends/pi/broski-entries";
import { entryAttachmentId, entryItemId, storedToolCallId } from "../../backends/pi/ids";
import { itemsOfEntry, userMessageEvent } from "../../backends/pi/mapping/message-items";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS, UserMessageEvent } from "../../contract";
import { assistant, ENTRY_MS, mapEntry, messageEntry, REQUEST_ID, toolCall } from "./mapping_fixtures";

const PROMPT: PromptRecord = { clientRequestId: REQUEST_ID, imageNames: ["shot.png", null] };

const map = mapEntry;

describe("user messages", () => {
	test("a string is one user_message with the entry's id and time", () => {
		const items = map(messageEntry("e1", { role: "user", content: "hello", timestamp: 1 }));
		expect(items).toEqual([{ kind: "user_message", id: "e1:0", at: ENTRY_MS, text: "hello", attachments: [] }]);
	});

	test("text blocks are joined with a newline and images become references named by the prompt record", () => {
		const items = map(
			messageEntry("e1", {
				role: "user",
				timestamp: 1,
				content: [
					{ type: "text", text: "look" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
					{ type: "text", text: "and" },
					{ type: "image", data: "BBBB", mimeType: "image/jpeg" },
				],
			}),
			{ prompt: PROMPT },
		);
		expect(items).toEqual([
			{
				kind: "user_message",
				id: "e1:0",
				at: ENTRY_MS,
				text: "look\nand",
				attachments: [
					{ kind: "image_ref", id: entryAttachmentId("e1", 1), mimeType: "image/png", name: "shot.png" },
					{ kind: "image_ref", id: entryAttachmentId("e1", 3), mimeType: "image/jpeg" },
				],
				clientRequestId: REQUEST_ID,
			},
		]);
	});

	test("an image with no mime type cannot be named and is left out; a missing or null content reads as empty", () => {
		const blank = map(
			messageEntry("e1", {
				role: "user",
				timestamp: 1,
				content: [{ type: "image", data: "AAAA", mimeType: "" }],
			}),
		);
		expect(blank).toMatchObject([{ text: "", attachments: [] }]);
		const nothing = JSON.parse(
			'{"type":"message","id":"e2","parentId":null,"timestamp":"2026-01-02T03:04:05.000Z","message":{"role":"user","content":null,"timestamp":1}}',
		);
		expect(map(nothing)).toMatchObject([{ text: "", attachments: [] }]);
	});

	test("text past the bound is cut to it", () => {
		const items = map(messageEntry("e1", { role: "user", content: "x".repeat(MAX_TEXT_CHARS + 5), timestamp: 1 }));
		expect(items[0]).toMatchObject({ kind: "user_message" });
		expect(items[0]?.kind === "user_message" && items[0].text.length).toBe(MAX_TEXT_CHARS);
	});

	test("references are bounded to the contract's list size", () => {
		const images = Array.from({ length: MAX_LIST_ITEMS + 3 }, () => ({
			type: "image" as const,
			data: "A",
			mimeType: "image/png",
		}));
		const items = map(messageEntry("e1", { role: "user", content: images, timestamp: 1 }));
		expect(items[0]?.kind === "user_message" && items[0].attachments).toHaveLength(MAX_LIST_ITEMS);
	});

	test("an unreadable entry time leaves the item with no time", () => {
		const bad = { ...messageEntry("e1", { role: "user", content: "hi", timestamp: 1 }), timestamp: "yesterday" };
		expect(map(bad)).toEqual([{ kind: "user_message", id: "e1:0", text: "hi", attachments: [] }]);
	});

	test("the live user_message has the same text, references and an id equal to the stored item's", () => {
		const content = [
			{ type: "text" as const, text: "look" },
			{ type: "image" as const, data: "AAAA", mimeType: "image/png" },
		];
		const live = UserMessageEvent.parse(userMessageEvent(content, "e1", PROMPT));
		const stored = map(messageEntry("e1", { role: "user", content, timestamp: 1 }), { prompt: PROMPT });
		expect(stored[0]).toMatchObject({
			id: live.messageId,
			text: live.text,
			attachments: live.attachments,
			clientRequestId: live.clientRequestId,
		});
		expect(userMessageEvent("plain", "e2", undefined)).toEqual({
			type: "user_message",
			messageId: entryItemId("e2", 0),
			text: "plain",
			attachments: [],
		});
	});
});

describe("assistant messages", () => {
	const message = assistant([
		{ type: "thinking", thinking: "hmm", thinkingSignature: "sig" },
		{ type: "text", text: "answer" },
		toolCall("call_1", "read", { path: "a.md" }),
		{ type: "text", text: "" },
		{ type: "thinking", thinking: "", thinkingSignature: "encrypted" },
		{ type: "text", text: "after" },
	]);

	test("a block per non-empty text or thinking block and a call per toolCall, at their content index", () => {
		const items = map(messageEntry("a1", message));
		expect(items).toEqual([
			{ kind: "block", id: "a1:0", at: ENTRY_MS, messageId: "a1", block: "thinking", text: "hmm" },
			{ kind: "block", id: "a1:1", at: ENTRY_MS, messageId: "a1", block: "text", text: "answer" },
			{
				kind: "tool_call",
				id: "a1:2",
				at: ENTRY_MS,
				toolCallId: storedToolCallId("a1", 2),
				messageId: "a1",
				name: "read",
				input: { path: "a.md" },
			},
			{ kind: "block", id: "a1:5", at: ENTRY_MS, messageId: "a1", block: "text", text: "after" },
		]);
	});

	test("a call's stored id is where it sits, whatever id the provider gave it", () => {
		const long = "c".repeat(500);
		const items = map(
			messageEntry("a1", assistant([toolCall("", "bash"), toolCall(long, "bash"), toolCall("dup", "bash")])),
		);
		expect(items.map((item) => item.kind === "tool_call" && item.toolCallId)).toEqual(["a1:0", "a1:1", "a1:2"]);
	});

	test("a call with no name gets the placeholder name; a missing content reads as empty", () => {
		expect(map(messageEntry("a1", assistant([toolCall("c", "")])))).toMatchObject([{ name: "unnamed" }]);
		const bare = JSON.parse(
			'{"type":"message","id":"a2","parentId":null,"timestamp":"2026-01-02T03:04:05.000Z","message":{"role":"assistant","stopReason":"stop"}}',
		);
		expect(map(bare)).toEqual([]);
	});

	test("call input is bounded JSON: a huge string is cut", () => {
		const items = map(
			messageEntry("a1", assistant([toolCall("c", "write", { content: "y".repeat(MAX_TEXT_CHARS + 1) })])),
		);
		const input = items[0]?.kind === "tool_call" ? items[0].input : undefined;
		expect(input).toEqual({ content: "y".repeat(MAX_TEXT_CHARS) });
	});
});

describe("tool results", () => {
	const result = (extra: Record<string, unknown> = {}) =>
		messageEntry("r1", {
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read",
			content: [{ type: "text", text: "file text" }],
			isError: false,
			timestamp: 1,
			...extra,
		});

	test("one tool_result for the call the branch says it answers", () => {
		const call = storedToolCallId("a1", 2);
		expect(map(result(), { toolCallId: call })).toEqual([
			{
				kind: "tool_result",
				id: "r1:0",
				at: ENTRY_MS,
				toolCallId: call,
				outcome: "completed",
				result: { content: [{ kind: "text", text: "file text" }], fileChanges: [] },
			},
		]);
	});

	test("with no call known it stands alone under its own id", () => {
		expect(map(result())).toMatchObject([{ toolCallId: "r1:0" }]);
	});

	test("a failed result keeps its text as the error and reports no file changes", () => {
		const failed = result({
			toolName: "edit",
			isError: true,
			content: [{ type: "text", text: "Could not edit file" }],
			details: { diff: "d", patch: "--- a\n+++ a\n@@ -1 +1 @@\n-x\n+y\n" },
		});
		expect(map(failed, { toolCallId: "c" })).toMatchObject([
			{ outcome: "failed", result: { content: [], fileChanges: [], error: "Could not edit file" } },
		]);
	});

	test("images are read back by attachment id at their content index", () => {
		const items = map(
			result({
				content: [
					{ type: "text", text: "see" },
					{ type: "image", data: "AAAA", mimeType: "image/png" },
				],
			}),
			{ toolCallId: "c" },
		);
		expect(items).toMatchObject([
			{
				result: {
					content: [
						{ kind: "text", text: "see" },
						{ kind: "image_ref", id: entryAttachmentId("r1", 1), mimeType: "image/png" },
					],
				},
			},
		]);
	});

	test("edit's unified patch is the file change, its path read from the patch when the call is not known", () => {
		const patch = "--- src/a.ts\n+++ src/a.ts\n@@ -1,3 +1,3 @@\n keep\n-old\n-older\n+new\n keep2\n";
		const edit = result({ toolName: "edit", details: { diff: "display", patch, firstChangedLine: 2 } });
		expect(map(edit, { toolCallId: "c" })).toMatchObject([
			{ result: { fileChanges: [{ path: "src/a.ts", change: "modified", diff: patch, additions: 1, deletions: 2 }] } },
		]);
		expect(map(edit, { toolCallId: "c", toolInput: { path: "given.ts", edits: [] } })).toMatchObject([
			{ result: { fileChanges: [{ path: "given.ts" }] } },
		]);
	});

	test("write needs the call's path; without it no change is claimed", () => {
		const write = result({ toolName: "write", details: undefined });
		expect(map(write, { toolCallId: "c", toolInput: { path: "new.md", content: "x" } })).toMatchObject([
			{ result: { fileChanges: [{ path: "new.md", change: "modified" }] } },
		]);
		expect(map(write, { toolCallId: "c" })).toMatchObject([{ result: { fileChanges: [] } }]);
	});

	test("terminal escapes in output are removed", () => {
		const items = map(result({ content: [{ type: "text", text: "\u001b[31mred\u001b[0m" }] }), { toolCallId: "c" });
		expect(items).toMatchObject([{ result: { content: [{ text: "red" }] } }]);
	});

	test("a missing content reads as empty", () => {
		const bare = JSON.parse(
			'{"type":"message","id":"r2","parentId":null,"timestamp":"2026-01-02T03:04:05.000Z","message":{"role":"toolResult","toolCallId":"c","toolName":"read","isError":false}}',
		);
		expect(map(bare)).toMatchObject([{ result: { content: [], fileChanges: [] } }]);
	});
});

test("a call's input is a copy: changing Pi's arguments later does not change the item", () => {
	const args = { path: "p", edits: [{ oldText: "a", newText: "b" }] };
	const items = itemsOfEntry(messageEntry("a1", assistant([toolCall("c", "edit", args)])), {});
	args.edits[0] = { oldText: "changed", newText: "changed" };
	expect(items).toMatchObject([{ input: { path: "p", edits: [{ oldText: "a", newText: "b" }] } }]);
});
