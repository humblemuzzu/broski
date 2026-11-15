/**
 * On the real adapter: the permission gate Pi does not have. In `ask` mode a tool
 * call waits for the phone: allowed, denied (with a message), denied and stopped, withdrawn by an abort,
 * remembered for the session, and reached through a codemode script's nested call.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Interaction, PermissionOption, ToolFinishedEvent } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import type { ScriptStep } from "./helpers/pi-router";
import { call, readReadme, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

const ASK = [{ axis: "permissions", value: "ask" }];
const README_TEXT = "# Project";

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

function optionsOf(interaction: Interaction): readonly PermissionOption[] {
	if (interaction.request.kind !== "tool_permission") throw new Error(`asked a ${interaction.request.kind}`);
	return interaction.request.options;
}

type Pick = (option: PermissionOption) => boolean;
const allowOnce: Pick = (option) => option.effect === "allow" && option.scope === "once";
const allowSession: Pick = (option) => option.effect === "allow" && option.scope === "session";
const deny: Pick = (option) => option.effect === "deny" && !option.stopsRun;
const denyAndStop: Pick = (option) => option.effect === "deny" && option.stopsRun;

async function decide(live: LiveSession, interaction: Interaction, pick: Pick, message?: string) {
	const option = optionsOf(interaction).find(pick);
	if (!option) throw new Error(`no such option among ${optionsOf(interaction).map((candidate) => candidate.id)}`);
	return live.control.answer({
		interactionId: interaction.id,
		reply: { kind: "tool_permission", optionId: option.id, ...(message !== undefined && { message }), grantIds: [] },
	});
}

async function askingSession(rig: LiveRig, steps: readonly ScriptStep[]): Promise<LiveSession> {
	const live = await rig.rig.openNew({ modes: ASK });
	rig.router.script(live.ref.sessionId, steps);
	await live.prompt("Use your tools.");
	return live;
}

const finishedTools = (live: LiveSession): ToolFinishedEvent[] =>
	live.events().flatMap((event) => (event.type === "tool_finished" ? [event] : []));

const ranTool = (event: ToolFinishedEvent) => JSON.stringify(event.result).includes(README_TEXT);

describe("the gate in ask mode", () => {
	test("asks before a tool runs, names the call, and an allow lets it run", async () => {
		t = await LiveRig.create();
		const live = await askingSession(t, [readReadme(), say("Read it.")]);
		const { interaction } = await live.waitFor("interaction_requested");
		const events = live.events().map((event) => event.type);
		expect(events.indexOf("tool_started")).toBeGreaterThanOrEqual(0);
		expect(events.indexOf("tool_started")).toBeLessThan(events.indexOf("interaction_requested"));
		expect(interaction).toMatchObject({
			blocksRun: true,
			runId: live.reduced().run?.runId,
			origin: { toolName: "read" },
		});
		expect(interaction.request).toMatchObject({
			kind: "tool_permission",
			inputEditable: true,
			input: { path: "README.md" },
		});
		expect(optionsOf(interaction).some(allowOnce)).toBe(true);
		expect(optionsOf(interaction).some(allowSession)).toBe(true);
		expect(optionsOf(interaction).some(deny)).toBe(true);
		expect(optionsOf(interaction).some(denyAndStop)).toBe(true);
		expect(finishedTools(live)).toEqual([]);

		expect((await decide(live, interaction, allowOnce)).status).toBe("accepted");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		const [tool] = finishedTools(live);
		expect(tool?.outcome).toBe("completed");
		expect(tool && ranTool(tool)).toBe(true);
		live.assertSettled();
	});

	test("a deny keeps the tool from running and tells the model why; the run goes on", async () => {
		t = await LiveRig.create();
		const live = await askingSession(t, [readReadme(), say("Understood.")]);
		const { interaction } = await live.waitFor("interaction_requested");
		await decide(live, interaction, deny, "Not that file.");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		const [tool] = finishedTools(live);
		expect(tool?.outcome).toBe("denied");
		expect(tool && ranTool(tool)).toBe(false);
		const second = t.router.requests(live.ref.sessionId)[1]?.messages.at(-1);
		expect(second).toMatchObject({ role: "tool" });
		expect(JSON.stringify(second)).toContain("Not that file.");
		live.assertSettled();
	});

	test("deny and stop ends the run aborted, with the tool not run", async () => {
		t = await LiveRig.create();
		const live = await askingSession(t, [readReadme(), say("Never said.")]);
		const { interaction } = await live.waitFor("interaction_requested");
		await decide(live, interaction, denyAndStop);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("aborted");
		const [tool] = finishedTools(live);
		expect(tool?.outcome).not.toBe("completed");
		expect(tool && ranTool(tool)).toBe(false);
		live.assertSettled();
	});

	test("an abort while it waits withdraws the ask; the tool never runs", async () => {
		t = await LiveRig.create();
		const live = await askingSession(t, [readReadme(), say("Never said.")]);
		const { interaction } = await live.waitFor("interaction_requested");
		await live.control.abort();
		const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === interaction.id);
		expect(resolved.reason).toBe("withdrawn");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("aborted");
		const [tool] = finishedTools(live);
		expect(tool?.outcome).not.toBe("completed");
		expect(tool && ranTool(tool)).toBe(false);
		live.assertSettled();
	});

	test("allow for the session is remembered for that tool only", async () => {
		t = await LiveRig.create();
		const write = call("write", { path: "out.txt", content: "x" });
		const live = await askingSession(t, [readReadme(), readReadme(), write, say("Done.")]);
		const first = await live.waitFor("interaction_requested");
		await decide(live, first.interaction, allowSession);
		const writeAsk = await live.waitFor(
			"interaction_requested",
			(event) => event.interaction.origin?.toolName === "write",
		);
		expect(live.events().filter((event) => event.type === "interaction_requested")).toHaveLength(2);
		await decide(live, writeAsk.interaction, deny);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(finishedTools(live).map((tool) => tool.outcome)).toEqual(["completed", "completed", "denied"]);
	});

	test("allow for the session holds for the session: after its host ended, and after a restart", async () => {
		t = await LiveRig.create();
		const live = await askingSession(t, [readReadme(), say("Read.")]);
		const { interaction } = await live.waitFor("interaction_requested");
		await decide(live, interaction, allowSession);
		await live.waitFor("run_finished");
		await live.close();
		await t.router.shutDown(live.ref.sessionId);
		await t.rig.restart();

		const reopened = await t.rig.open(live.ref);
		t.router.script(live.ref.sessionId, [readReadme(), say("Read again.")]);
		expect((await reopened.run("Once more.")).outcome.kind).toBe("completed");
		expect(reopened.events().some((event) => event.type === "interaction_requested")).toBe(false);
		expect(finishedTools(reopened).map(ranTool)).toEqual([true]);
	});
});

describe("the mode itself", () => {
	test("off asks nothing; switching to ask and back changes only the calls after it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const asks = () => live.events().filter((event) => event.type === "interaction_requested").length;
		await t.rig.arrange(live.ref, { kind: "tool" });
		await live.run("Free to go.");
		expect(asks()).toBe(0);

		expect((await live.control.setMode("permissions", "ask")).status).toBe("accepted");
		await t.rig.arrange(live.ref, { kind: "tool" });
		const mark = live.recorder.items.length;
		await live.prompt("Now ask.");
		const { interaction } = await live.waitFor("interaction_requested", () => true, mark);
		await decide(live, interaction, allowOnce);
		await live.waitFor("run_finished", () => true, mark);
		expect(asks()).toBe(1);

		expect((await live.control.setMode("permissions", "off")).status).toBe("accepted");
		await t.rig.arrange(live.ref, { kind: "tool" });
		await live.run("Free again.");
		expect(asks()).toBe(1);
	});

	test("ask survives the session being closed and reopened after its runtime ended", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modes: ASK });
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Remember the mode.");
		await live.close();
		await t.router.shutDown(live.ref.sessionId);
		const reopened = await t.rig.open(live.ref);
		expect(reopened.initial.modes).toEqual(ASK);
	});
});

describe("a codemode script's nested call", () => {
	const SCRIPT = 'return await tools.read({ path: "README.md" });';

	test("is asked after the codemode call itself, as a child of it", async () => {
		t = await LiveRig.create({ settings: { defaultTools: ["+codemode"] } });
		const live = await askingSession(t, [call("codemode", { code: SCRIPT }), say("Done.")]);
		const outer = await live.waitFor("interaction_requested");
		expect(outer.interaction.origin?.toolName).toBe("codemode");
		await decide(live, outer.interaction, allowOnce);

		const inner = await live.waitFor("interaction_requested", (event) => event.interaction.origin?.toolName === "read");
		expect(inner.interaction.origin?.parentToolCallId).toBe(outer.interaction.origin?.toolCallId);
		expect(
			live
				.events()
				.some(
					(event) => event.type === "tool_started" && event.name === "read" && event.parentToolCallId !== undefined,
				),
		).toBe(true);
		await decide(live, inner.interaction, allowOnce);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		const nested = finishedTools(live).filter((tool) => ranTool(tool));
		expect(nested.length).toBeGreaterThan(0);
		live.assertSettled();
	});

	test("denying the nested call fails the script, not the run", async () => {
		t = await LiveRig.create({ settings: { defaultTools: ["+codemode"] } });
		const live = await askingSession(t, [call("codemode", { code: SCRIPT }), say("Done.")]);
		const outer = await live.waitFor("interaction_requested");
		await decide(live, outer.interaction, allowOnce);
		const inner = await live.waitFor("interaction_requested", (event) => event.interaction.origin?.toolName === "read");
		await decide(live, inner.interaction, deny, "No nested reads.");
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		const nested = finishedTools(live).find((tool) => tool.toolCallId !== outer.interaction.origin?.toolCallId);
		expect(nested?.outcome).toBe("denied");
		live.assertSettled();
	});
});
