import { describe, expect, test } from "bun:test";
import { humanDenial } from "../../../backends/claude-code/ui/denial";
import type { Interaction, PlanApprovalReply, PlanApprovalRequest } from "../../../contract";
import { DeskRig } from "./desk-rig";

const PLAN = "# Plan\n\n1. Do it.\n";
const INPUT = { plan: PLAN, planFilePath: "/home/me/.claude/plans/calm-fox.md" };

function request(interaction: Interaction): PlanApprovalRequest {
	if (interaction.request.kind !== "plan_approval") throw new Error(`a ${interaction.request.kind} ask`);
	return interaction.request;
}

function approve(extra: Partial<PlanApprovalReply> = {}): PlanApprovalReply {
	return { kind: "plan_approval", decision: "approve", ...extra };
}

describe("ExitPlanMode", () => {
	test("shows the plan and path, is editable, and offers the host's modes starting on default", () => {
		const rig = new DeskRig();
		rig.tool("ExitPlanMode", INPUT, { requiresUserInteraction: true });
		const interaction = rig.only();
		expect(interaction).toMatchObject({ title: "Plan ready for review", blocksRun: true });
		expect(request(interaction)).toMatchObject({
			plan: PLAN,
			editable: true,
			path: INPUT.planFilePath,
			modeOptions: { axis: "permissions", defaultValue: "default" },
		});
		expect(request(interaction).modeOptions?.options.map((option) => option.value)).toEqual([
			"default",
			"acceptEdits",
			"auto",
		]);
	});

	test("approve as it is: allow with the input untouched, continuing in the default mode", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("ExitPlanMode", INPUT);
		expect(rig.answer(rig.only(), approve())).toEqual({ status: "accepted" });
		expect(await ask.promise).toEqual({
			behavior: "allow",
			updatedInput: INPUT,
			updatedPermissions: [{ type: "setMode", mode: "default", destination: "session" }],
		});
	});

	test("approve with a chosen mode and an edited plan: the plan in updatedInput and the mode as a session setMode", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("ExitPlanMode", INPUT);
		rig.answer(rig.only(), approve({ plan: "# Plan\n\n1. EDITED", modeAfter: "acceptEdits" }));
		expect(await ask.promise).toEqual({
			behavior: "allow",
			updatedInput: { ...INPUT, plan: "# Plan\n\n1. EDITED" },
			updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
		});
	});

	test("the same plan sent back is not an edit", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("ExitPlanMode", INPUT);
		rig.answer(rig.only(), approve({ plan: PLAN }));
		const result = await ask.promise;
		expect(result).toMatchObject({ behavior: "allow", updatedInput: INPUT });
	});

	test("a host with no mode choice sends no setMode, and a mode it did not offer is refused", async () => {
		const rig = new DeskRig();
		rig.planModes = undefined;
		const ask = rig.tool("ExitPlanMode", INPUT);
		const interaction = rig.only();
		expect(request(interaction).modeOptions).toBeUndefined();
		expect(rig.answer(interaction, approve({ modeAfter: "acceptEdits" }))).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		rig.answer(interaction, approve());
		expect(await ask.promise).toEqual({ behavior: "allow", updatedInput: INPUT });
	});

	test("reject is a deny carrying the feedback, without interrupting: the session stays in plan mode", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("ExitPlanMode", INPUT);
		rig.answer(rig.only(), { kind: "plan_approval", decision: "reject", feedback: "Add a test step first." });
		expect(await ask.promise).toEqual({ behavior: "deny", message: humanDenial("Add a test step first.") });
		expect(rig.aborts).toEqual([]);
	});

	test("a plan nobody wrote is shown empty and not editable", () => {
		const rig = new DeskRig();
		rig.tool("ExitPlanMode", {});
		expect(request(rig.only())).toMatchObject({ plan: "", editable: false });
	});

	test("the feedback of an approval, and an edit of a plan that cannot be edited, are refused", () => {
		const rig = new DeskRig();
		rig.tool("ExitPlanMode", {});
		const interaction = rig.only();
		expect(rig.answer(interaction, approve({ feedback: "no" }))).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect(rig.answer(interaction, approve({ plan: "new" }))).toMatchObject({ rejection: { code: "invalid_input" } });
	});
});
