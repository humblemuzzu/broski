/** Tool permissions and AskUserQuestion through the desk against the real CLI (what the recorded frames and spikes show). */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptedTurn } from "../../helpers/scripted-anthropic-server";
import { expectNoOrphans } from "../spike/rig/orphans";
import { finishTurn, permissionModes, toolResults, withRealCli } from "./rig/real-run";

expectNoOrphans();

const CLI_MS = 40_000;
const WRITE: ScriptedTurn[] = [
	{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
	{ text: ["Done."] },
];
const COLOR = {
	question: "Which color?",
	header: "Color",
	multiSelect: false,
	options: [
		{ label: "Red", description: "warm" },
		{ label: "Blue", description: "cool" },
	],
};
const ASK: ScriptedTurn[] = [
	{ toolCalls: [{ name: "AskUserQuestion", args: { questions: [COLOR] } }] },
	{ text: ["Noted."] },
];

function toolUseIds(messages: readonly SDKMessage[]): string[] {
	return messages.flatMap((message) =>
		message.type === "assistant"
			? message.message.content.flatMap((block) => (block.type === "tool_use" ? [block.id] : []))
			: [],
	);
}

describe("a Write permission through the real CLI", () => {
	test(
		"carries the CLI's own prompt text, the tool call's id and a session suggestion; allow-for-session writes the file and switches the mode",
		async () => {
			await withRealCli({ permissionMode: "default", turns: WRITE }, async (run) => {
				const turn = finishTurn(run, "write it");
				const interaction = await run.rig.requestedAt(0);
				expect(interaction.origin?.toolName).toBe("Write");
				expect(toolUseIds(run.spike.messages)).toContain(interaction.origin?.toolCallId ?? "none");
				expect(interaction.request).toMatchObject({
					kind: "tool_permission",
					deliberate: false,
					previews: [{ kind: "paths", paths: [expect.stringContaining("notes.txt")] }],
				});
				if (interaction.request.kind !== "tool_permission") throw new Error("not a permission");
				expect(interaction.request.options.map((option) => option.id)).toEqual([
					"allow_once",
					"allow_session",
					"deny_once",
					"deny_stop",
				]);
				const answered = run.rig.answer(interaction, {
					kind: "tool_permission",
					optionId: "allow_session",
					grantIds: [],
				});
				expect(answered).toEqual({ status: "accepted" });
				expect((await turn).subtype).toBe("success");
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(true);
				expect(permissionModes(run.spike.messages).at(-1)).toBe("acceptEdits");
				expect(run.rig.resolved()).toEqual([{ interactionId: interaction.id, reason: "answered" }]);
			});
		},
		CLI_MS,
	);

	test(
		"a plain allow once writes the file and leaves the mode alone",
		async () => {
			await withRealCli({ permissionMode: "default", turns: WRITE }, async (run) => {
				const turn = finishTurn(run, "write it");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, { kind: "tool_permission", optionId: "allow_once", grantIds: [] });
				await turn;
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(true);
				expect(new Set(permissionModes(run.spike.messages))).toEqual(new Set(["default"]));
			});
		},
		CLI_MS,
	);

	test(
		"deny once carries the person's words to the model and the turn goes on",
		async () => {
			await withRealCli({ permissionMode: "default", turns: WRITE }, async (run) => {
				const turn = finishTurn(run, "write it");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, {
					kind: "tool_permission",
					optionId: "deny_once",
					grantIds: [],
					message: "Not that file.",
				});
				const result = await turn;
				expect(result).toMatchObject({ subtype: "success", terminal_reason: "completed" });
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(false);
				expect(toolResults(run.spike.messages)).toContain("Not that file.");
			});
		},
		CLI_MS,
	);

	test(
		"deny and stop interrupts the turn, and the host is asked to abort the run",
		async () => {
			await withRealCli({ permissionMode: "default", turns: WRITE }, async (run) => {
				const turn = finishTurn(run, "write it");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, { kind: "tool_permission", optionId: "deny_stop", grantIds: [] });
				const result = await turn;
				expect(result.terminal_reason).toMatch(/^aborted/);
				expect(existsSync(join(run.home.projectDir, "notes.txt"))).toBe(false);
				expect(run.rig.aborts).toEqual(["abort"]);
			});
		},
		CLI_MS,
	);
});

describe("AskUserQuestion through the real CLI", () => {
	test(
		"arrives with the CLI's requiresUserInteraction; the answer is keyed by question text and the model sees it",
		async () => {
			await withRealCli({ permissionMode: "default", turns: ASK }, async (run) => {
				const turn = finishTurn(run, "ask me");
				const interaction = await run.rig.requestedAt(0);
				expect(interaction.request).toMatchObject({
					kind: "questions",
					questions: [
						{ id: "0", text: "Which color?", header: "Color", multiSelect: false, allowCustom: true, required: true },
					],
				});
				run.rig.answer(interaction, { kind: "questions", answers: [{ questionId: "0", selected: ["Blue"] }] });
				await turn;
				const result = run.spike.messages.find(
					(message) => message.type === "user" && message.tool_use_result !== undefined,
				);
				expect(result?.type === "user" && result.tool_use_result).toMatchObject({
					answers: { "Which color?": "Blue" },
				});
				expect(toolResults(run.spike.messages)).toContain("Blue");
			});
		},
		CLI_MS,
	);

	test(
		"a free-text answer reaches the model as the answer to that question",
		async () => {
			await withRealCli({ permissionMode: "default", turns: ASK }, async (run) => {
				const turn = finishTurn(run, "ask me");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, {
					kind: "questions",
					answers: [{ questionId: "0", selected: [], custom: "Teal" }],
				});
				await turn;
				expect(toolResults(run.spike.messages)).toContain("Teal");
			});
		},
		CLI_MS,
	);

	test(
		"a cancel is a plain deny: the model is told and the turn completes",
		async () => {
			await withRealCli({ permissionMode: "default", turns: ASK }, async (run) => {
				const turn = finishTurn(run, "ask me");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, { kind: "cancel", stopRun: false });
				expect((await turn).terminal_reason).toBe("completed");
				expect(toolResults(run.spike.messages)).toContain("The user denied this request.");
			});
		},
		CLI_MS,
	);
});
