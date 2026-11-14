/**
 * Permission asks through `canUseTool` (adapter README D15, D16), recorded as frame fixtures for the mapping:
 * a Write allowed and denied, an AskUserQuestion answered, and a callback that throws.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ScriptedTurn } from "../../helpers/scripted-anthropic-server";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const WRITE_TURNS: ScriptedTurn[] = [
	{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
	{ text: ["Done."] },
];
const QUESTION = "Which color?";
const ASK_TURNS = [
	{
		toolCalls: [
			{
				name: "AskUserQuestion",
				args: {
					questions: [
						{
							question: QUESTION,
							header: "Color",
							multiSelect: false,
							options: [
								{ label: "Red", description: "warm" },
								{ label: "Blue", description: "cool" },
							],
						},
					],
				},
			},
		],
	},
	{ text: ["Blue it is."] },
];

type Ask = { name: string; input: Record<string, unknown>; options: Omit<Parameters<CanUseTool>[2], "signal"> };

function toolResultText(messages: readonly SDKMessage[]): string {
	const result = messages.find((m) => m.type === "user" && m.tool_use_result !== undefined);
	return JSON.stringify(result?.type === "user" ? result.message.content : null);
}

async function runAsk(turns: ScriptedTurn[], answer: CanUseTool, scenario: string | null) {
	const asks: Ask[] = [];
	const spike = startSpike({
		permissionMode: "default",
		turns,
		options: {
			canUseTool: async (name, input, options) => {
				const { signal: _signal, ...rest } = options;
				asks.push({ name, input, options: rest });
				return answer(name, input, options);
			},
		},
	});
	try {
		spike.send("go");
		await spike.waitFor((m) => m.type === "result");
		await spike.waitFor(isIdle, { after: spike.messages.findIndex((m) => m.type === "result") });
		if (scenario) spike.record(scenario);
		const wrote = existsSync(join(spike.home.projectDir, "notes.txt"));
		return { asks, messages: [...spike.messages], wrote };
	} finally {
		await spike.close();
	}
}

describe("permission asks", () => {
	test(
		"allow: the Write runs; the ask carried a session setMode suggestion and the file name as description",
		async () => {
			const run = await runAsk(
				WRITE_TURNS,
				async (_name, input) => ({ behavior: "allow", updatedInput: input }),
				"permission-allow",
			);
			expect(run.asks).toHaveLength(1);
			expect(run.asks[0]?.options).toMatchObject({
				displayName: "Write",
				description: "notes.txt",
				suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
				toolUseID: expect.any(String),
				requestId: expect.any(String),
			});
			expect(run.wrote).toBe(true);
			const states = run.messages.flatMap((m) =>
				m.type === "system" && m.subtype === "session_state_changed" ? [m.state] : [],
			);
			expect(states).toEqual(["running", "requires_action", "running", "idle"]);
		},
		CLI_TEST_MS,
	);

	test(
		"deny: the model gets an error tool result with the message and the turn goes on",
		async () => {
			const run = await runAsk(
				WRITE_TURNS,
				async () => ({ behavior: "deny", message: "Not that file." }),
				"permission-deny",
			);
			expect(run.wrote).toBe(false);
			expect(toolResultText(run.messages)).toContain("Not that file.");
			expect(run.messages.find((m) => m.type === "result")).toMatchObject({
				subtype: "success",
				terminal_reason: "completed",
			});
		},
		CLI_TEST_MS,
	);

	test(
		"AskUserQuestion: reaches canUseTool with requiresUserInteraction; answers keyed by question text",
		async () => {
			const run = await runAsk(
				ASK_TURNS,
				async (_name, input) => ({ behavior: "allow", updatedInput: { ...input, answers: { [QUESTION]: "Blue" } } }),
				"ask-user-question",
			);
			expect(run.asks[0]).toMatchObject({ name: "AskUserQuestion", options: { requiresUserInteraction: true } });
			const result = run.messages.find((m) => m.type === "user" && m.tool_use_result !== undefined);
			expect(result?.type === "user" && result.tool_use_result).toMatchObject({ answers: { [QUESTION]: "Blue" } });
			expect(toolResultText(run.messages)).toContain("Blue");
		},
		CLI_TEST_MS,
	);

	test(
		"a canUseTool that throws is a denial carrying the error text; the CLI neither hangs nor exits",
		async () => {
			const run = await runAsk(
				WRITE_TURNS,
				async () => {
					throw new Error("callback exploded");
				},
				null,
			);
			expect(run.wrote).toBe(false);
			expect(toolResultText(run.messages)).toContain("Tool permission request failed: Error: callback exploded");
			expect(run.messages.find((m) => m.type === "result")).toMatchObject({ subtype: "success" });
		},
		CLI_TEST_MS,
	);
});
