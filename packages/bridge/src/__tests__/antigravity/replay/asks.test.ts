/**
 * agy's recorded asks played to the production host (`host-rig.ts`): each permission and question as the phone sees
 * it, and the person's reply going back to agy as the very record the bridge sent agy in the recording (the replay
 * fails on any other). A stop while agy's question waits answers it cancelled and ends the run aborted.
 */

import { describe, expect, test } from "bun:test";
import type { AgentEvent, Interaction, InteractionReply } from "../../../contract";
import { hostedReplay } from "./host-rig";

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
	for (const { scenario, file, optionId } of [
		{ scenario: "permission-allow", file: "allowed.txt", optionId: "allow" },
		{ scenario: "permission-deny", file: "denied.txt", optionId: "deny" },
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
			expect(ask).toMatchObject({
				title: `touch ${file}`,
				blocksRun: true,
				origin: { toolCallId, toolName: "run_command" },
				request: {
					kind: "tool_permission",
					input: { CommandLine: `touch ${file}`, WaitMsBeforeAsync: 5000, toolSummary: `Create ${file}` },
					inputEditable: false,
					reason: `Create ${file}`,
					previews: [{ kind: "command", command: `touch ${file}` }],
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
		const path = "<WORKSPACE>/notes.txt";
		expect(asks(rig.events()).map((ask) => [ask.title, ask.origin?.toolName, ask.request])).toEqual([
			[
				"notes.txt",
				"write_file",
				expect.objectContaining({
					previews: [
						{
							kind: "file_changes",
							changes: [{ path, change: "added", diff: expect.stringContaining("+one"), additions: 1, deletions: 0 }],
						},
					],
					options: AGY_OPTIONS,
				}),
			],
			[
				"notes.txt",
				"edit_file",
				expect.objectContaining({
					previews: [
						{
							kind: "file_changes",
							changes: [
								{ path, change: "modified", diff: expect.stringContaining("-one\n+two"), additions: 1, deletions: 1 },
							],
						},
					],
					options: AGY_OPTIONS,
				}),
			],
		]);
	});

	const questions: Array<{
		scenario: string;
		labels: string[];
		multiSelect: boolean;
		reply: InteractionReply;
		answer: string;
	}> = [
		{
			scenario: "question-single",
			labels: ["Red", "Blue"],
			multiSelect: false,
			reply: { kind: "questions", answers: [{ questionId: "q1", selected: ["Blue"] }] },
			answer: "Blue",
		},
		{
			scenario: "question-multi",
			labels: ["(Recommended) Apple", "Pear", "Plum"],
			multiSelect: true,
			reply: { kind: "questions", answers: [{ questionId: "q1", selected: ["(Recommended) Apple", "Pear"] }] },
			answer: "You chose Apple and Pear.",
		},
		{
			scenario: "question-decline",
			labels: ["Yes", "No"],
			multiSelect: true,
			reply: { kind: "cancel", stopRun: false },
			answer: "none",
		},
	];

	for (const { scenario, labels, multiSelect, reply, answer } of questions) {
		test(`${scenario}: agy's question as the phone's, its labels as agy wrote them; the reply goes back as agy got it`, async () => {
			const rig = await hostedReplay(scenario, { reply: () => reply });
			await rig.asRecorded();
			const events = rig.events();
			const [ask, other] = asks(events);
			expect(other).toBeUndefined();
			const toolCallId = events.find((event) => event.type === "tool_started")?.toolCallId;
			expect(ask).toMatchObject({ blocksRun: true, origin: { toolCallId, toolName: "ask_question" } });
			expect(ask?.request).toEqual({
				kind: "questions",
				questions: [
					{
						id: "q1",
						text: "Which ones?",
						options: labels.map((label) => ({ label })),
						multiSelect,
						allowCustom: true,
						secret: false,
						required: false,
					},
				],
			});
			expect(resolutions(events)).toEqual(["answered"]);
			const text = events.flatMap((event) => (event.type === "block_finished" ? [event.text] : []));
			expect(text).toEqual([answer]);
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
