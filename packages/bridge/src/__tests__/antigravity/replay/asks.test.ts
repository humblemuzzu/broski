/**
 * agy's recorded asks played to the production host (`host-rig.ts`): each permission and question as the phone sees
 * it, and the person's reply going back to agy as the very record the bridge sent agy in the recording (the replay
 * fails on any other). A stop while agy's question waits answers it cancelled and ends the run aborted. What the model
 * chose (a command, a file, a question's words and labels, its answer) is held to what agy wrote in the recording
 * (`recorded.ts`), and a question is answered as the recorder answered it (`record/scenarios.ts` `PICKED`, `picking`).
 */

import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import type { AgentEvent, Interaction, InteractionReply } from "../../../contract";
import { PICKED, picking } from "../record/scenarios";
import { hostedReplay } from "./host-rig";
import { chunkText, questionOf, textArgument, toolInput } from "./recorded";

function asks(events: readonly AgentEvent[]): Interaction[] {
	return events.flatMap((event) => (event.type === "interaction_requested" ? [event.interaction] : []));
}

function resolutions(events: readonly AgentEvent[]): string[] {
	return events.flatMap((event) => (event.type === "interaction_resolved" ? [event.reason] : []));
}

const option = (id: string, label: string, effect: "allow" | "deny") => ({
	id,
	label,
	effect,
	scope: "once",
	stopsRun: false,
	message: "none",
});

const AGY_OPTIONS = [option("allow", "Allow", "allow"), option("deny", "Deny", "deny")];

describe("agy's recorded asks, on the bridge's host", () => {
	for (const { scenario, optionId } of [
		{ scenario: "permission-allow", optionId: "allow" },
		{ scenario: "permission-deny", optionId: "deny" },
	]) {
		test(`${scenario}: a command's permission shows the command, agy's options and reason; the choice goes back as agy got it`, async () => {
			const rig = await hostedReplay(scenario, {
				reply: () => ({ kind: "tool_permission", optionId, grantIds: [] }),
			});
			await rig.asRecorded();
			const events = rig.events();
			const [ask, other] = asks(events);
			expect(other).toBeUndefined();
			const toolCallId = events.find((event) => event.type === "tool_started")?.toolCallId;
			const input = toolInput(rig.front, "run_command");
			const command = textArgument(input, "CommandLine");
			expect(ask).toMatchObject({
				title: command,
				blocksRun: true,
				origin: { toolCallId, toolName: "run_command" },
				request: {
					kind: "tool_permission",
					input,
					inputEditable: false,
					reason: textArgument(input, "toolSummary"),
					previews: [{ kind: "command", command }],
					options: AGY_OPTIONS,
					grants: [],
					deliberate: false,
				},
			});
			expect(ask?.request).not.toHaveProperty("defaultOptionId");
			expect(resolutions(events)).toEqual(["answered"]);
		});
	}

	test("tool-edit-diff: a write's and an edit's permissions are titled by the file and preview agy's diffs", async () => {
		const rig = await hostedReplay("tool-edit-diff", {
			reply: () => ({ kind: "tool_permission", optionId: "allow", grantIds: [] }),
		});
		await rig.asRecorded();
		const written = toolInput(rig.front, "write_file");
		const edited = toolInput(rig.front, "edit_file");
		const path = textArgument(written, "Path");
		expect(textArgument(edited, "Path")).toBe(path);
		expect(asks(rig.events()).map((ask) => [ask.title, ask.origin?.toolName, ask.request])).toEqual([
			[
				basename(path),
				"write_file",
				expect.objectContaining({
					previews: [
						{
							kind: "file_changes",
							changes: [
								{
									path,
									change: "added",
									diff: expect.stringContaining(`+${textArgument(written, "Content")}`),
									additions: 1,
									deletions: 0,
								},
							],
						},
					],
					options: AGY_OPTIONS,
				}),
			],
			[
				basename(path),
				"edit_file",
				expect.objectContaining({
					previews: [
						{
							kind: "file_changes",
							changes: [
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
					],
					options: AGY_OPTIONS,
				}),
			],
		]);
	});

	const questions: Array<{ scenario: string; multiSelect?: boolean; reply: (ask: Interaction) => InteractionReply }> = [
		{ scenario: "question-single", multiSelect: false, reply: picking(PICKED["question-single"]) },
		{ scenario: "question-multi", multiSelect: true, reply: picking(PICKED["question-multi"]) },
		{ scenario: "question-decline", reply: () => ({ kind: "cancel", stopRun: false }) },
	];

	for (const { scenario, multiSelect, reply } of questions) {
		test(`${scenario}: agy's question as the phone's, its labels as agy wrote them; the reply goes back as agy got it`, async () => {
			const rig = await hostedReplay(scenario, { reply });
			await rig.asRecorded();
			const events = rig.events();
			const [ask, other] = asks(events);
			expect(other).toBeUndefined();
			const toolCallId = events.find((event) => event.type === "tool_started")?.toolCallId;
			expect(ask).toMatchObject({ blocksRun: true, origin: { toolCallId, toolName: "ask_question" } });
			const asked = questionOf(rig.front);
			if (multiSelect !== undefined) expect(asked.several).toBe(multiSelect);
			expect(ask?.request).toEqual({
				kind: "questions",
				questions: [
					{
						id: "q1",
						text: asked.text,
						options: asked.labels.map((label) => ({ label })),
						multiSelect: asked.several,
						allowCustom: true,
						secret: false,
						required: false,
					},
				],
			});
			expect(resolutions(events)).toEqual(["answered"]);
			const text = events.flatMap((event) => (event.type === "block_finished" ? [event.text] : []));
			expect(text.join("")).toBe(chunkText(rig.front, "agent_message_chunk"));
			expect(rig.host.snapshot().lastOutcome).toEqual({ kind: "completed" });
		});
	}

	test("a stop while agy's question waits sends session/cancel, answers it cancelled, and ends the run aborted", async () => {
		const rig = await hostedReplay("cancel-with-pending-ask");
		await rig.asRecorded();
		const events = rig.events();
		expect(asks(events).map((ask) => ask.request.kind)).toEqual(["questions"]);
		expect(resolutions(events)).toEqual(["withdrawn"]);
		expect(events.findLast((event) => event.type === "tool_finished")).toMatchObject({ outcome: "failed" });
		expect(events.at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		expect(rig.host.snapshot()).toMatchObject({ interactions: [], tools: [], lastOutcome: { kind: "aborted" } });
	});
});
