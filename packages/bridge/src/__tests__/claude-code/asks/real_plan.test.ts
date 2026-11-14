/**
 * ExitPlanMode through the desk against the real CLI: approve, approve edited with a mode, reject (adapter README D17).
 */

import { describe, expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { planRoute } from "../spike/rig/plan-script";
import { finishTurn, permissionModes, type RealRun, toolResults, withRealCli } from "./rig/real-run";

expectNoOrphans();

const CLI_MS = 40_000;
const PLAN = "# Plan\n1. Original step\n";

async function planned<T>(body: (run: RealRun) => Promise<T>): Promise<T> {
	const routes = [planRoute(PLAN, [{ text: ["After the plan."] }, { text: ["Second turn."] }])];
	return withRealCli({ permissionMode: "plan", routes }, body);
}

describe("ExitPlanMode through the real CLI", () => {
	test(
		"shows the plan the CLI read from its plan file, with the modes and the path; approving it leaves plan mode for the default",
		async () => {
			await planned(async (run) => {
				const turn = finishTurn(run, "plan it");
				const interaction = await run.rig.requestedAt(0);
				expect(interaction.request).toMatchObject({
					kind: "plan_approval",
					plan: PLAN,
					editable: true,
					path: expect.stringContaining("/plans/"),
					modeOptions: { axis: "permissions", defaultValue: "default" },
				});
				run.rig.answer(interaction, { kind: "plan_approval", decision: "approve" });
				await turn;
				expect(toolResults(run.spike.messages)).toContain("## Approved Plan:");
				expect(permissionModes(run.spike.messages).at(-1)).toBe("default");
			});
		},
		CLI_MS,
	);

	test(
		"an edited plan reaches the model as edited and the chosen mode takes effect",
		async () => {
			await planned(async (run) => {
				const turn = finishTurn(run, "plan it");
				const interaction = await run.rig.requestedAt(0);
				const edited = "# Plan\n1. EDITED step";
				run.rig.answer(interaction, {
					kind: "plan_approval",
					decision: "approve",
					plan: edited,
					modeAfter: "acceptEdits",
				});
				await turn;
				expect(toolResults(run.spike.messages)).toContain("## Approved Plan (edited by user):");
				expect(toolResults(run.spike.messages)).toContain("EDITED step");
				const result = run.spike.messages.find(
					(message) =>
						message.type === "user" &&
						message.tool_use_result !== undefined &&
						JSON.stringify(message.tool_use_result).includes("planWasEdited"),
				);
				expect(result?.type === "user" && result.tool_use_result).toMatchObject({ plan: edited, planWasEdited: true });
				expect(permissionModes(run.spike.messages).at(-1)).toBe("acceptEdits");
			});
		},
		CLI_MS,
	);

	test(
		"rejecting carries the feedback to the model and the session stays in plan mode",
		async () => {
			await planned(async (run) => {
				const turn = finishTurn(run, "plan it");
				const interaction = await run.rig.requestedAt(0);
				run.rig.answer(interaction, { kind: "plan_approval", decision: "reject", feedback: "Add a test step first." });
				await turn;
				expect(toolResults(run.spike.messages)).toContain("Add a test step first.");
				expect(new Set(permissionModes(run.spike.messages))).toEqual(new Set(["plan"]));
			});
		},
		CLI_MS,
	);
});
