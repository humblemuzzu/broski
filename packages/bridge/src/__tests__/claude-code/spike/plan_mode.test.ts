/**
 * ExitPlanMode in `plan` mode (adapter README D17). The CLI takes the plan from the plan file the
 * model wrote (its path is in the plan-mode reminder), and hands `canUseTool` `{plan, planFilePath}`.
 */

import { describe, expect, test } from "bun:test";
import type { PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expectNoOrphans } from "./rig/orphans";
import { planRoute } from "./rig/plan-script";
import { startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const PLAN = "# Plan\n1. Original step\n";

type Seen = { input: Record<string, unknown> | null; suggestions: unknown };

function modesOf(messages: readonly SDKMessage[]): string[] {
	return messages.flatMap((m) =>
		m.type === "system" && (m.subtype === "init" || m.subtype === "status") && m.permissionMode
			? [m.permissionMode]
			: [],
	);
}

function exitPlanResult(messages: readonly SDKMessage[]) {
	return messages.find((m) => m.type === "user" && JSON.stringify(m.message.content).includes("toolu_scripted_2_0"));
}

async function runPlan(answer: (input: Record<string, unknown>) => PermissionResult, scenario: string) {
	const seen: Seen = { input: null, suggestions: null };
	const spike = startSpike({
		permissionMode: "plan",
		turns: [],
		server: { routes: [planRoute(PLAN, [{ text: ["after exit"] }, { text: ["second turn"] }])] },
		options: {
			canUseTool: async (name, input, options) => {
				if (name !== "ExitPlanMode") return { behavior: "allow", updatedInput: input };
				seen.input = input;
				seen.suggestions = options.suggestions ?? [];
				return answer(input);
			},
		},
	});
	try {
		spike.send("plan it");
		await spike.waitFor((m) => m.type === "result");
		spike.record(scenario);
		spike.send("go on");
		const at = spike.messages.length;
		await spike.waitFor((m) => m.type === "result", { after: at });
		const lastBody = JSON.stringify(spike.server.requests().at(-2)?.body);
		return { seen, messages: [...spike.messages], lastBody, modes: modesOf(spike.messages) };
	} finally {
		await spike.close();
	}
}

describe("ExitPlanMode answers", () => {
	test(
		"approve as-is: canUseTool sees {plan, planFilePath}, no suggestions; the session returns to default",
		async () => {
			const run = await runPlan((input) => ({ behavior: "allow", updatedInput: input }), "exit-plan-approve");
			expect(run.seen.input).toEqual({ plan: PLAN, planFilePath: expect.stringMatching(/\/plans\/[a-z0-9-]+\.md$/) });
			expect(run.seen.suggestions).toEqual([]);
			expect(run.lastBody).toContain("## Approved Plan:");
			expect(run.modes.at(-1)).toBe("default");
		},
		CLI_TEST_MS,
	);

	test(
		"approve with an edited updatedInput.plan: the model gets the edited plan and planWasEdited is set",
		async () => {
			const edited = "# Plan\n1. EDITED step";
			const run = await runPlan(
				(input) => ({ behavior: "allow", updatedInput: { ...input, plan: edited } }),
				"exit-plan-edited",
			);
			expect(run.lastBody).toContain("## Approved Plan (edited by user):");
			expect(run.lastBody).toContain("EDITED step");
			const result = exitPlanResult(run.messages);
			expect(result?.type === "user" && result.tool_use_result).toMatchObject({ plan: edited, planWasEdited: true });
		},
		CLI_TEST_MS,
	);

	test(
		"approve with a setMode update: the session continues in the chosen mode",
		async () => {
			const run = await runPlan(
				(input) => ({
					behavior: "allow",
					updatedInput: input,
					updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
				}),
				"exit-plan-set-mode",
			);
			expect(run.modes.at(-1)).toBe("acceptEdits");
		},
		CLI_TEST_MS,
	);

	test(
		"deny with feedback: an error tool result carrying the message, and the session stays in plan",
		async () => {
			const run = await runPlan(() => ({ behavior: "deny", message: "Add a test step first." }), "exit-plan-deny");
			const result = exitPlanResult(run.messages);
			expect(JSON.stringify(result?.type === "user" && result.message.content)).toContain("Add a test step first.");
			expect(run.modes.every((mode) => mode === "plan")).toBe(true);
		},
		CLI_TEST_MS,
	);
});
