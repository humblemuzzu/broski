/**
 * agy's recorded turns played to the production host (`host-rig.ts`): what the phone sees of agy's chunks, tool calls,
 * usage, title, settings and commands, and of a compaction; every stream held to the contract's stream rules, and
 * every record the host sends agy the one the bridge sent in the recording.
 */

import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../../../contract";
import { updateOf } from "../live/wire-log";
import { hostedReplay, type Phone } from "./host-rig";

const allow: Phone = { reply: () => ({ kind: "tool_permission", optionId: "allow", grantIds: [] }) };
const deny: Phone = { reply: () => ({ kind: "tool_permission", optionId: "deny", grantIds: [] }) };

const CONTEXT_WINDOW = 1_048_576;

function blocks(events: readonly AgentEvent[]): Array<{ kind: string; text: string; messageId: string }> {
	return events.flatMap((event) => {
		if (event.type !== "block_started") return [];
		const finished = events.find((other) => other.type === "block_finished" && other.blockId === event.blockId);
		const text = finished?.type === "block_finished" ? finished.text : "";
		return [{ kind: event.kind, text, messageId: event.messageId }];
	});
}

/** Each tool row as the phone sees it: how it started, the kinds of its updates, and how it finished. */
function tools(events: readonly AgentEvent[]) {
	return events.flatMap((event) => {
		if (event.type !== "tool_started") return [];
		const ofThis = (other: AgentEvent) => "toolCallId" in other && other.toolCallId === event.toolCallId;
		const updates = events.flatMap((other) =>
			other.type === "tool_updated" && ofThis(other) ? [other.update.kind] : [],
		);
		const end = events.find((other) => other.type === "tool_finished" && ofThis(other));
		const { name, title, input } = event;
		return [
			{
				name,
				title,
				input,
				updates,
				...(end?.type === "tool_finished" && { outcome: end.outcome, result: end.result }),
			},
		];
	});
}

describe("agy's recorded turns, on the bridge's host", () => {
	const answered = [
		{
			scenario: "plain-turn",
			thinking: "low",
			title: "Request To Reply Ok",
			prompt: { text: "Reply with exactly: ok", attachments: [] },
			blocks: [["text", "ok"]],
			usage: { contextTokens: 9_974, cachedTokens: 0, promptTokens: 9_973 },
		},
		{
			scenario: "thinking",
			thinking: "high",
			title: "Calculate 4567 Times 89",
			prompt: { text: expect.stringContaining("4567 times 89"), attachments: [] },
			blocks: [
				["thinking", expect.stringMatching(/^\*\*Calculating the Solution\*\*[\s\S]+\*\*Interpreting the Prompt\*\*/)],
				["text", "406463"],
			],
			usage: { contextTokens: 11_144, cachedTokens: 0, promptTokens: 9_996 },
		},
		{
			scenario: "image-turn",
			thinking: "low",
			title: "Identifying Image Color",
			prompt: {
				text: "What colour is this image? Reply with one word.",
				attachments: [{ kind: "image_ref", id: expect.any(String), mimeType: "image/png" }],
			},
			blocks: [["text", "Red"]],
			usage: { contextTokens: 11_245, cachedTokens: 0, promptTokens: 11_215 },
		},
	];

	for (const turn of answered) {
		test(`${turn.scenario}: agy's chunks are one message's blocks, with the settings, usage, title and commands agy sent`, async () => {
			const rig = await hostedReplay(turn.scenario);
			await rig.asRecorded();
			const events = rig.events();
			expect(events.filter((event) => event.type === "user_message")).toEqual([expect.objectContaining(turn.prompt)]);
			const shown = blocks(events);
			expect(shown.map((block) => [block.kind, block.text])).toEqual(turn.blocks);
			expect(new Set(shown.map((block) => block.messageId)).size).toBe(1);
			expect(events.filter((event) => event.type === "model_changed").at(-1)).toEqual({
				type: "model_changed",
				modelId: "gemini-3.8-flash",
				thinking: turn.thinking,
			});
			expect(rig.host.snapshot()).toMatchObject({
				modelId: "gemini-3.8-flash",
				thinking: turn.thinking,
				modes: [{ axis: "mode", value: "default" }],
				usage: {
					contextTokens: turn.usage.contextTokens,
					contextWindow: CONTEXT_WINDOW,
					cache: { confidence: "exact", cachedTokens: turn.usage.cachedTokens, promptTokens: turn.usage.promptTokens },
				},
				lastOutcome: { kind: "completed" },
			});
			expect(rig.host.summary().title).toEqual({ text: turn.title, source: "generated" });
			expect(rig.commands.at(-1)).toContain("compact");
			expect(rig.host.commandList()?.map((command) => command.name)).toEqual(rig.commands.at(-1));
			expect(rig.catalog).toContainEqual({ type: "catalog_invalidated", scope: "commands" });
		});
	}

	test("a command agy ran shows its row, its output and the exit code agy sent; a denied one fails in agy's words", async () => {
		const ran = await hostedReplay("permission-allow", allow);
		await ran.asRecorded();
		expect(tools(ran.events())).toEqual([
			{
				name: "run_command",
				title: "touch allowed.txt",
				input: { CommandLine: "touch allowed.txt", WaitMsBeforeAsync: 5000, toolSummary: "Create allowed.txt" },
				updates: ["output_replaced"],
				outcome: "completed",
				result: {
					content: [{ kind: "text", text: expect.stringContaining("Command exited with code 0.") }],
					fileChanges: [],
					exitCode: 0,
				},
			},
		]);
		const refused = await hostedReplay("permission-deny", deny);
		await refused.asRecorded();
		const [denied] = tools(refused.events());
		expect(denied?.outcome).toBe("failed");
		expect(denied?.result?.error).toStartWith('permission check failed for command "touch denied.txt"');
		expect(denied?.result?.exitCode).toBeUndefined();
		expect(refused.host.snapshot().lastOutcome).toEqual({ kind: "completed" });
	});

	test("a file agy wrote and then edited is titled by its name, each call finishing with its diff", async () => {
		const rig = await hostedReplay("tool-edit-diff", allow);
		await rig.asRecorded();
		const path = "<WORKSPACE>/notes.txt";
		expect(tools(rig.events())).toEqual([
			{
				name: "write_file",
				title: "notes.txt",
				input: { Content: "one", Path: path },
				updates: ["file_changes"],
				outcome: "completed",
				result: {
					content: [],
					fileChanges: [{ path, change: "added", diff: expect.stringContaining("+one"), additions: 1, deletions: 0 }],
				},
			},
			{
				name: "edit_file",
				title: "notes.txt",
				input: { Path: path, Replacement: "two", Target: "one" },
				updates: ["file_changes"],
				outcome: "completed",
				result: {
					content: [],
					fileChanges: [
						{ path, change: "modified", diff: expect.stringContaining("-one\n+two"), additions: 1, deletions: 1 },
					],
				},
			},
		]);
		expect(blocks(rig.events()).map((block) => block.text)).toEqual(["done"]);
	});

	test("a second prompt while agy streams is refused busy, and agy is sent the first prompt alone", async () => {
		const rig = await hostedReplay("mid-turn-second-prompt");
		await rig.play((frame) => updateOf(frame)?.sessionUpdate === "agent_message_chunk");
		expect(rig.events().filter((event) => event.type === "block_delta")).toHaveLength(1);
		const second = rig.host.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "Reply with exactly: ok",
			attachments: [],
		});
		expect(second).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		await rig.asRecorded();
		const numbers = Array.from({ length: 60 }, (_, index) => String(index + 1)).join("\n");
		expect(blocks(rig.events()).map((block) => block.text)).toEqual([numbers]);
		expect(rig.host.snapshot().lastOutcome).toEqual({ kind: "completed" });
	});

	test("the phone's compaction of a loaded session is agy's /compact turn, shown as a compaction from the fill before it", async () => {
		const rig = await hostedReplay("compact", { compacts: true });
		await rig.asRecorded();
		const events = rig.events();
		expect(events.map((event) => event.type)).toEqual([
			"usage_updated",
			"model_changed",
			"compaction_started",
			"usage_updated",
			"usage_updated",
			"compaction_finished",
		]);
		expect(events.at(-1)).toEqual({
			type: "compaction_finished",
			outcome: { kind: "completed", tokensBefore: 9_974 },
		});
		expect(rig.host.summary().title).toEqual({ text: "Request To Reply Ok", source: "generated" });
		expect(rig.host.snapshot().compaction).toBeUndefined();
	});
});
