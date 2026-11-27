/**
 * agy's recorded turns played to the production host (`host-rig.ts`): what the phone sees of agy's chunks, tool calls,
 * usage, title, settings and commands, and of a compaction; every stream held to the contract's stream rules, and
 * every record the host sends agy the one the bridge sent in the recording. What the model chose (its words, the
 * title, a tool's arguments, the token counts) is held to what agy wrote in the recording (`recorded.ts`), so the tests
 * pass on any recording of the scenarios.
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import type { AgentEvent } from "../../../contract";
import { OK_PROMPT } from "../live/runs";
import { updateOf } from "../live/wire-log";
import { hostedReplay, type Phone } from "./host-rig";
import { chunkText, fillOf, promptOf, promptUsage, settingOf, textArgument, titleOf, toolInput } from "./recorded";

const allow: Phone = { reply: () => ({ kind: "tool_permission", optionId: "allow", grantIds: [] }) };
const deny: Phone = { reply: () => ({ kind: "tool_permission", optionId: "deny", grantIds: [] }) };

function blocks(events: readonly AgentEvent[]): Array<{ kind: string; text: string; messageId: string }> {
	return events.flatMap((event) => {
		if (event.type !== "block_started") return [];
		const finished = events.find((other) => other.type === "block_finished" && other.blockId === event.blockId);
		const text = finished?.type === "block_finished" ? finished.text : "";
		return [{ kind: event.kind, text, messageId: event.messageId }];
	});
}

/** The text of the run's blocks of `kind`, run together. */
function shownText(events: readonly AgentEvent[], kind: "text" | "thinking"): string {
	return blocks(events)
		.filter((block) => block.kind === kind)
		.map((block) => block.text)
		.join("");
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
		{ scenario: "plain-turn", kinds: ["text"], attachments: [] },
		{ scenario: "thinking", kinds: ["thinking", "text"], attachments: [] },
		{
			scenario: "image-turn",
			kinds: ["text"],
			attachments: [{ kind: "image_ref", id: expect.any(String), mimeType: "image/png" }],
		},
	];

	for (const turn of answered) {
		test(`${turn.scenario}: agy's chunks are one message's blocks, with the settings, usage, title and commands agy sent`, async () => {
			const rig = await hostedReplay(turn.scenario);
			await rig.asRecorded();
			const { front } = rig;
			const events = rig.events();
			expect(events.filter((event) => event.type === "user_message")).toEqual([
				expect.objectContaining({ text: promptOf(front), attachments: turn.attachments }),
			]);
			const shown = blocks(events);
			expect(shown.map((block) => block.kind)).toEqual(turn.kinds);
			expect(shownText(events, "text")).toBe(chunkText(front, "agent_message_chunk"));
			expect(shownText(events, "thinking")).toBe(chunkText(front, "agent_thought_chunk"));
			expect(new Set(shown.map((block) => block.messageId)).size).toBe(1);
			const modelId = settingOf(front, "model");
			const thinking = settingOf(front, "thought_level");
			expect(events.filter((event) => event.type === "model_changed").at(-1)).toEqual({
				type: "model_changed",
				modelId,
				thinking,
			});
			const fill = fillOf(front);
			const { inputTokens = 0, cachedReadTokens = 0 } = promptUsage(front);
			const snapshot = rig.host.snapshot();
			expect(snapshot).toMatchObject({
				modelId,
				thinking,
				modes: [{ axis: "mode", value: settingOf(front, "mode") }],
				usage: {
					contextTokens: fill.used,
					contextWindow: fill.size,
					cache: { confidence: "exact", cachedTokens: cachedReadTokens },
				},
				lastOutcome: { kind: "completed" },
			});
			expect([inputTokens, inputTokens + cachedReadTokens]).toContain(snapshot.usage?.cache?.promptTokens ?? -1);
			expect(rig.host.summary().title).toEqual({ text: titleOf(front), source: "generated" });
			expect(rig.commands.at(-1)).toContain("compact");
			expect(rig.host.commandList()?.map((command) => command.name)).toEqual(rig.commands.at(-1));
			expect(rig.catalog).toContainEqual({ type: "catalog_invalidated", scope: "commands" });
		});
	}

	test("a command agy ran shows its row, its output and the exit code agy sent; a denied one fails in agy's words", async () => {
		const ran = await hostedReplay("permission-allow", allow);
		await ran.asRecorded();
		const command = toolInput(ran.front, "run_command");
		expect(tools(ran.events())).toEqual([
			{
				name: "run_command",
				title: textArgument(command, "CommandLine"),
				input: command,
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
		const deniedCommand = textArgument(toolInput(refused.front, "run_command"), "CommandLine");
		expect(denied?.result?.error).toStartWith(`permission check failed for command "${deniedCommand}"`);
		expect(denied?.result?.exitCode).toBeUndefined();
		expect(refused.host.snapshot().lastOutcome).toEqual({ kind: "completed" });
	});

	test("a file agy wrote and then edited is titled by its name, each call finishing with its diff", async () => {
		const rig = await hostedReplay("tool-edit-diff", allow);
		await rig.asRecorded();
		const written = toolInput(rig.front, "write_file");
		const edited = toolInput(rig.front, "edit_file");
		const path = textArgument(written, "Path");
		expect(textArgument(edited, "Path")).toBe(path);
		expect(tools(rig.events())).toEqual([
			{
				name: "write_file",
				title: basename(path),
				input: written,
				updates: ["file_changes"],
				outcome: "completed",
				result: {
					content: [],
					fileChanges: [
						{
							path,
							change: "added",
							diff: expect.stringContaining(`+${textArgument(written, "Content")}`),
							additions: 1,
							deletions: 0,
						},
					],
				},
			},
			{
				name: "edit_file",
				title: basename(path),
				input: edited,
				updates: ["file_changes"],
				outcome: "completed",
				result: {
					content: [],
					fileChanges: [
						{
							path,
							change: "modified",
							diff: expect.stringContaining(
								`-${textArgument(edited, "Target")}\n+${textArgument(edited, "Replacement")}`,
							),
							additions: 1,
							deletions: 1,
						},
					],
				},
			},
		]);
		expect(shownText(rig.events(), "text")).toBe(chunkText(rig.front, "agent_message_chunk"));
	});

	test("a second prompt while agy streams is refused busy, and agy is sent the first prompt alone", async () => {
		const rig = await hostedReplay("mid-turn-second-prompt");
		await rig.play((frame) => updateOf(frame)?.sessionUpdate === "agent_message_chunk");
		expect(rig.events().filter((event) => event.type === "block_delta")).toHaveLength(1);
		const second = rig.host.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: OK_PROMPT,
			attachments: [],
		});
		expect(second).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		await rig.asRecorded();
		expect(blocks(rig.events()).map((block) => block.text)).toEqual([chunkText(rig.front, "agent_message_chunk")]);
		expect(rig.host.snapshot().lastOutcome).toEqual({ kind: "completed" });
	});

	test("the phone's compaction of a loaded session is agy's /compact turn, shown as a compaction from the fill before it", async () => {
		const rig = await hostedReplay("compact", { compacts: true });
		await rig.asRecorded();
		const events = rig.events();
		expect(events.map((event) => event.type).filter((type) => type !== "usage_updated")).toEqual([
			"model_changed",
			"compaction_started",
			"compaction_finished",
		]);
		expect(events[0]?.type).toBe("usage_updated");
		expect(events.at(-1)).toEqual({
			type: "compaction_finished",
			outcome: { kind: "completed", tokensBefore: fillOf(rig.front, "session/prompt").used },
		});
		expect(rig.host.summary().title).toEqual({ text: titleOf(rig.front), source: "generated" });
		expect(rig.host.snapshot().compaction).toBeUndefined();
	});
});
