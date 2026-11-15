/**
 * The permission gate end to end: the bridge's extension in the real `pi` holds a `tool_call` until the phone decides
 * (`host/extension/index.ts`). What the human reads (a command, cut or written out), calls asked one at a time, the
 * reason a model reads for a deny, and the human's edit of the input, checked by Pi against the tool.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Interaction,
	Interaction as InteractionSchema,
	MAX_TEXT_CHARS,
	type PermissionOption,
	type ToolFinishedEvent,
	type ToolPermissionRequest,
} from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import type { ScriptedTurn } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { textOf } from "./helpers/pi-router";
import { call, readReadme, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const ASK = [{ axis: "permissions", value: "ask" }];

async function asking(rig: LiveRig, steps: readonly ScriptedTurn[]): Promise<LiveSession> {
	const live = await rig.rig.openNew({ modes: ASK });
	rig.router.script(live.ref.sessionId, steps);
	await live.prompt("Use your tools.");
	return live;
}

function permissionOf(interaction: Interaction): ToolPermissionRequest {
	if (interaction.request.kind !== "tool_permission") throw new Error(`asked a ${interaction.request.kind}`);
	return interaction.request;
}

function optionId(interaction: Interaction, pick: (option: PermissionOption) => boolean): string {
	const option = permissionOf(interaction).options.find(pick);
	if (!option) throw new Error("no such option");
	return option.id;
}

const allowOnce = (option: PermissionOption) => option.effect === "allow" && option.scope === "once";
const deny = (option: PermissionOption) => option.effect === "deny" && !option.stopsRun;

function decide(live: LiveSession, interaction: Interaction, pick: (option: PermissionOption) => boolean, extra = {}) {
	return live.control.answer({
		interactionId: interaction.id,
		reply: { kind: "tool_permission", optionId: optionId(interaction, pick), grantIds: [], ...extra },
	});
}

const finished = (live: LiveSession): ToolFinishedEvent[] =>
	live.events().flatMap((event) => (event.type === "tool_finished" ? [event] : []));

/** The tool results the model was sent in the session's newest request. */
function toolResultsSent(rig: LiveRig, live: LiveSession): string[] {
	const request = rig.router.requests(live.ref.sessionId).at(-1);
	return (request?.messages ?? []).flatMap((message) => (message.role === "tool" ? [textOf(message.content)] : []));
}

describe("what the human reads", () => {
	test("a bash call shows its command and the directory it runs in", async () => {
		t = await LiveRig.create();
		const live = await asking(t, [call("bash", { command: "echo hi" }), say("done")]);
		const { interaction } = await live.waitFor("interaction_requested");
		expect(permissionOf(interaction).previews).toEqual([{ kind: "command", command: "echo hi", cwd: t.cwd }]);
		await decide(live, interaction, allowOnce);
		await live.waitFor("run_finished");
		expect(toolResultsSent(t, live).join("\n")).toContain("hi");
	});

	test("a command past the contract's bounds is shown cut, says so, cannot be edited and has no one-tap answer", async () => {
		t = await LiveRig.create();
		const command = `echo ${"x".repeat(MAX_TEXT_CHARS + 500)}`;
		const live = await asking(t, [call("bash", { command }), say("done")]);
		const { interaction } = await live.waitFor("interaction_requested");
		const request = permissionOf(interaction);
		const shown = request.previews[0]?.kind === "command" ? request.previews[0].command : "";
		expect(shown.length).toBe(MAX_TEXT_CHARS);
		expect(shown.startsWith(command.slice(0, MAX_TEXT_CHARS - 100))).toBe(true);
		expect(shown.endsWith("more characters not shown]")).toBe(true);
		expect(request).toMatchObject({ inputEditable: false, deliberate: true });
		expect(request.reason).toContain("only its start is shown");
		expect(InteractionSchema.safeParse(interaction).success).toBe(true);
		await decide(live, interaction, deny);
		await live.waitFor("run_finished");
	});

	test("what could hide part of a command is written out where the human reads it", async () => {
		t = await LiveRig.create();
		const live = await asking(t, [
			call("bash", { command: "echo safe\r\u001b[2Krm -rf ~ \u202e gnp.exe" }),
			say("done"),
		]);
		const { interaction } = await live.waitFor("interaction_requested");
		expect(permissionOf(interaction).previews[0]).toMatchObject({
			kind: "command",
			command: "echo safe\\u{D}\\u{1B}[2Krm -rf ~ \\u{202E} gnp.exe",
		});
		await decide(live, interaction, deny);
		await live.waitFor("run_finished");
	});
});

describe("the answers", () => {
	test("two calls in one response are asked one at a time, in order", async () => {
		t = await LiveRig.create();
		writeFileSync(join(t.cwd, "NOTES.md"), "my notes\n");
		const both: ScriptedTurn = {
			toolCalls: [
				{ name: "read", args: { path: "README.md" } },
				{ name: "read", args: { path: "NOTES.md" } },
			],
		};
		const live = await asking(t, [both, say("done")]);
		const first = await live.waitFor("interaction_requested");
		expect(permissionOf(first.interaction).input).toEqual({ path: "README.md" });
		expect(live.session.snapshot().interactions).toHaveLength(1);
		await decide(live, first.interaction, allowOnce);
		const second = await live.waitFor(
			"interaction_requested",
			(event) => event.interaction.id !== first.interaction.id,
		);
		expect(permissionOf(second.interaction).input).toEqual({ path: "NOTES.md" });
		await decide(live, second.interaction, allowOnce);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(finished(live).map((tool) => tool.outcome)).toEqual(["completed", "completed"]);
	});

	test("deny with no words gives the model a plain reason, and the run goes on", async () => {
		t = await LiveRig.create();
		const live = await asking(t, [readReadme(), say("understood")]);
		const { interaction } = await live.waitFor("interaction_requested");
		await decide(live, interaction, deny);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(toolResultsSent(t, live)).toEqual(["The user denied this tool call."]);
		expect(finished(live).map((tool) => tool.outcome)).toEqual(["denied"]);
	});

	test("a cancel that continues blocks only the call; one that stops ends the run aborted", async () => {
		t = await LiveRig.create();
		const going = await asking(t, [readReadme(), say("goes on")]);
		const first = await going.waitFor("interaction_requested");
		await going.control.answer({ interactionId: first.interaction.id, reply: { kind: "cancel", stopRun: false } });
		expect((await going.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(toolResultsSent(t, going)).toEqual(["The user dismissed the permission request."]);

		const stopping = await asking(t, [readReadme(), say("never")]);
		const second = await stopping.waitFor("interaction_requested");
		await stopping.control.answer({ interactionId: second.interaction.id, reply: { kind: "cancel", stopRun: true } });
		expect((await stopping.waitFor("run_finished")).outcome.kind).toBe("aborted");
		stopping.assertSettled();
	});
});

describe("the human's edit of the input", () => {
	test("the tool runs with the edited input, in place", async () => {
		t = await LiveRig.create();
		writeFileSync(join(t.cwd, "NOTES.md"), "my notes\n");
		const live = await asking(t, [readReadme(), say("done")]);
		const { interaction } = await live.waitFor("interaction_requested");
		expect(await decide(live, interaction, allowOnce, { editedInput: { path: "NOTES.md" } })).toEqual({
			status: "accepted",
		});
		await live.waitFor("run_finished");
		expect(toolResultsSent(t, live).join("\n")).toContain("my notes");
	});

	test("an edit the tool's schema refuses is asked again, saying why, and the tool runs once allowed", async () => {
		t = await LiveRig.create();
		const live = await asking(t, [readReadme(), say("done")]);
		const first = await live.waitFor("interaction_requested");
		expect(await decide(live, first.interaction, allowOnce, { editedInput: { limit: "many" } })).toEqual({
			status: "accepted",
		});
		const again = await live.waitFor("interaction_requested", (event) => event.interaction.id !== first.interaction.id);
		expect(permissionOf(again.interaction).reason).toContain("limit");
		expect(finished(live)).toEqual([]);
		await decide(live, again.interaction, allowOnce);
		await live.waitFor("run_finished");
		expect(finished(live).map((tool) => tool.outcome)).toEqual(["completed"]);
	});

	test("an edit that is not an object, or carries a __proto__ key, is refused and the ask keeps waiting", async () => {
		t = await LiveRig.create();
		const live = await asking(t, [readReadme(), say("done")]);
		const { interaction } = await live.waitFor("interaction_requested");
		const list = await decide(live, interaction, allowOnce, { editedInput: ["README.md"] });
		const proto = await decide(live, interaction, allowOnce, {
			editedInput: JSON.parse('{"path":"README.md","__proto__":{"polluted":true}}'),
		});
		expect(list).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(proto).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(live.session.snapshot().interactions.map((pending) => pending.id)).toEqual([interaction.id]);
		await decide(live, interaction, deny);
		await live.waitFor("run_finished");
	});
});
