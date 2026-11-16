/** A terminal ask offers the grants the terminal's own dialog would, and picking one is the hook's allow with them. */

import { describe, expect, test } from "bun:test";
import type { PermissionRequestHookInput, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { permissionAsk } from "../../../backends/claude-code/terminal/hook-interaction";

const SESSION_RULE: PermissionUpdate = {
	type: "addRules",
	rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
	behavior: "allow",
	destination: "session",
};
const PROJECT_RULE: PermissionUpdate = { ...SESSION_RULE, destination: "localSettings" };

function asked(suggestions?: PermissionUpdate[]) {
	const input: PermissionRequestHookInput = {
		hook_event_name: "PermissionRequest",
		session_id: "5f0c2c55-6a3c-4a4e-9d0e-3c8d3c2b9a10",
		transcript_path: "/nowhere.jsonl",
		cwd: "/work",
		tool_name: "Bash",
		tool_input: { command: "npm test" },
		...(suggestions && { permission_suggestions: suggestions }),
	};
	const ask = permissionAsk(input, { id: "i-1", runId: undefined, createdAt: 0, toolCallId: undefined });
	const request = ask.interaction.request;
	if (request.kind !== "tool_permission") throw new Error("not a permission ask");
	return { ask, options: request.options };
}

describe("a terminal ask's grants", () => {
	test("sit between allow once and the denials, worded as the CLI words its rules", () => {
		const { options } = asked([SESSION_RULE, PROJECT_RULE]);
		expect(options.map((option) => [option.id, option.scope])).toEqual([
			["allow-once", "once"],
			["allow_session", "session"],
			["allow_always_local", "always"],
			["deny-once", "once"],
			["deny-and-stop", "once"],
		]);
		expect(options[2]).toMatchObject({
			label: "Always allow Bash(npm test:*) (this project, only for you)",
			rule: "Bash(npm test:*)",
		});
	});

	test("picking one allows with exactly the updates it stands for; allow once sends none", () => {
		const { ask } = asked([SESSION_RULE, PROJECT_RULE]);
		const pick = (optionId: string) => ask.decide({ kind: "tool_permission", optionId, grantIds: [] });
		expect(pick("allow_always_local")).toEqual({
			decision: { behavior: "allow", updatedPermissions: [PROJECT_RULE] },
		});
		expect(pick("allow_session")).toEqual({ decision: { behavior: "allow", updatedPermissions: [SESSION_RULE] } });
		expect(pick("allow-once")).toEqual({ decision: { behavior: "allow" } });
	});

	test("with no suggestions, the ask is allow once, deny, deny and stop", () => {
		expect(asked().options.map((option) => option.id)).toEqual(["allow-once", "deny-once", "deny-and-stop"]);
	});
});
