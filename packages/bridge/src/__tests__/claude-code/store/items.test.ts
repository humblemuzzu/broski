/** The entry → item mapping on its own: what the SDK's reader hands over, bounded and never throwing (D18). */

import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { itemsOf } from "../../../backends/claude-code/store/items";
import { nameImages } from "../../../backends/claude-code/store/items-user";
import { localCommandText } from "../../../backends/claude-code/store/local-commands";
import { MAX_ID_CHARS, MAX_TEXT_CHARS, TranscriptItem } from "../../../contract";

const CONTEXT = {
	prompt: () => undefined,
	blockBase: 0,
	toolName: () => undefined,
	childOf: () => undefined,
};

function entry(
	type: "user" | "assistant" | "system",
	message: unknown,
	extra: Record<string, unknown> = {},
): SessionMessage {
	return {
		type,
		uuid: crypto.randomUUID(),
		session_id: crypto.randomUUID(),
		message,
		parent_tool_use_id: null,
		parent_agent_id: null,
		...extra,
	};
}

const assistant = (id: string | undefined, content: unknown) =>
	entry("assistant", { ...(id !== undefined && { id }), content });

describe("assistant entries", () => {
	test("text, thinking and tool calls become items; empty text, redacted thinking and unknown blocks do not", () => {
		const items = itemsOf(
			assistant("msg_x", [
				{ type: "thinking", thinking: "hm" },
				{ type: "text", text: "   " },
				{ type: "redacted_thinking", data: "xx" },
				{ type: "text", text: "visible" },
				{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
				{ type: "web_search_tool_result", content: [] },
			]),
			CONTEXT,
		);
		expect(items.map((item) => item.id)).toEqual(["msg_x:0", "msg_x:3", "toolu_1"]);
		expect(items.every((item) => TranscriptItem.safeParse(item).success)).toBe(true);
	});

	test("block indexes continue from the blocks of the same message before this entry", () => {
		const items = itemsOf(assistant("msg_y", [{ type: "text", text: "later" }]), { ...CONTEXT, blockBase: 4 });
		expect(items.map((item) => item.id)).toEqual(["msg_y:4"]);
	});

	test("a message with no API id uses the entry uuid; a long one does too", () => {
		const none = assistant(undefined, [{ type: "text", text: "a" }]);
		const long = assistant("m".repeat(MAX_ID_CHARS + 1), [{ type: "text", text: "a" }]);
		expect(itemsOf(none, CONTEXT)[0]?.id).toBe(`${none.uuid}:0`);
		expect(itemsOf(long, CONTEXT)[0]?.id).toBe(`${long.uuid}:0`);
	});

	test("the pre-2.1.63 name Task reads as Agent, and a spawning call names its child", () => {
		const message = assistant("msg_z", [{ type: "tool_use", id: "toolu_a", name: "Task", input: {} }]);
		const [call] = itemsOf(message, {
			...CONTEXT,
			childOf: (id) => (id === "toolu_a" ? `${crypto.randomUUID()}/agent1` : undefined),
		});
		expect(call).toMatchObject({ kind: "tool_call", name: "Agent", childSession: { backend: "claude-code" } });
	});

	test("a tool id that does not fit is not made into a call; input is bounded and keeps a __proto__ key", () => {
		const input = JSON.parse('{"__proto__": {"x": 1}, "deep": {"a": {"b": 1}}}');
		const items = itemsOf(
			assistant("msg_w", [
				{ type: "tool_use", id: "t".repeat(MAX_ID_CHARS + 1), name: "Read", input: {} },
				{ type: "tool_use", id: "toolu_ok", name: "Read", input },
				{ type: "text", text: "x".repeat(MAX_TEXT_CHARS + 50) },
			]),
			CONTEXT,
		);
		expect(items.map((item) => item.kind)).toEqual(["tool_call", "block"]);
		const [call, block] = items;
		expect(call?.kind === "tool_call" && Object.hasOwn(call.input as object, "__proto__")).toBe(true);
		expect(block?.kind === "block" && block.text.length).toBe(MAX_TEXT_CHARS);
		expect(items.every((item) => TranscriptItem.safeParse(item).success)).toBe(true);
	});

	test("a surrogate pair at the cut is not split", () => {
		const text = `${"x".repeat(MAX_TEXT_CHARS - 1)}\u{1F600}`;
		const [block] = itemsOf(assistant("msg_s", [{ type: "text", text }]), CONTEXT);
		expect(block?.kind === "block" && block.text.length).toBe(MAX_TEXT_CHARS - 1);
	});

	test("a malformed message gives no items and does not throw", () => {
		for (const message of [undefined, null, 7, "text", [], { content: 5 }, { id: 4, content: [null, 3, "x", {}] }]) {
			expect(itemsOf(entry("assistant", message), CONTEXT)).toEqual([]);
			expect(itemsOf(entry("user", message), CONTEXT).every((item) => TranscriptItem.safeParse(item).success)).toBe(
				true,
			);
		}
	});
});

describe("user entries", () => {
	test("a prompt is a user message; with the journal's record it carries its clientRequestId", () => {
		const sent = entry("user", { role: "user", content: "hi there" });
		expect(itemsOf(sent, CONTEXT)).toMatchObject([{ kind: "user_message", id: sent.uuid, text: "hi there" }]);
		const [item] = itemsOf(sent, { ...CONTEXT, prompt: () => ({ imageNames: [] }) });
		expect(item?.kind === "user_message" && item.clientRequestId).toBe(sent.uuid);
	});

	test("text blocks join, a tool result is its own item, an entry with neither is empty", () => {
		const joined = entry("user", {
			content: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
		});
		expect(itemsOf(joined, CONTEXT)).toMatchObject([{ kind: "user_message", text: "a\nb" }]);
		const answered = entry("user", { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "ok" }] });
		expect(itemsOf(answered, CONTEXT).map((item) => item.id)).toEqual(["toolu_9:result"]);
		expect(itemsOf(entry("user", { content: [] }), CONTEXT)).toEqual([]);
	});

	test("a compaction summary is a compaction item", () => {
		const summary = entry("user", { content: "The summary." }, { isCompactSummary: true });
		expect(itemsOf(summary, CONTEXT)).toMatchObject([
			{ kind: "compaction", id: summary.uuid, summary: "The summary." },
		]);
	});

	test("system entries carry nothing the SDK's reader shows, so they give no item", () => {
		expect(itemsOf(entry("system", undefined), CONTEXT)).toEqual([]);
	});
});

describe("local commands", () => {
	test("the CLI's own command entries read as the command and its output", () => {
		expect(
			localCommandText(
				"<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>",
			),
		).toEqual({ kind: "typed", text: "/compact" });
		expect(localCommandText("<command-name>/model</command-name><command-args>opus</command-args>")).toEqual({
			kind: "typed",
			text: "/model opus",
		});
		expect(localCommandText("<local-command-stdout>Compacted </local-command-stdout>")).toEqual({
			kind: "output",
			level: "info",
			text: "Compacted",
		});
		expect(localCommandText("<local-command-stderr>no</local-command-stderr>")).toEqual({
			kind: "output",
			level: "error",
			text: "no",
		});
		expect(localCommandText("please run <command-name>x</command-name> for me")).toBeUndefined();
		expect(localCommandText("an ordinary prompt")).toBeUndefined();
	});
});

describe("image names", () => {
	test("the journal's names go to the images in order; a missing name leaves the ref alone", () => {
		const refs = ["a", "b", "c"].map((id) => ({ kind: "image_ref" as const, id, mimeType: "image/png" }));
		const named = nameImages(refs, { imageNames: ["one.png", undefined, "three.png"] });
		expect(named.map((ref) => ref.name)).toEqual(["one.png", undefined, "three.png"]);
		expect(nameImages(refs, undefined)).toEqual(refs);
	});
});
