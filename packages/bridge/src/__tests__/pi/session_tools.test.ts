/**
 * The `session_tools` op on a real Pi session: which tools it has and which are on, switching one, what survives a
 * reopen (the loadout the session file records), and the bound on a long list.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { MAX_LIST_ITEMS } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { LONG_DESCRIPTION, MANY_TOOLS } from "./helpers/many-tools-extension";
import { say } from "./helpers/scenarios";
import { sessionEntries } from "./helpers/session-files";
import { callTools, refusal, toolsIn } from "./helpers/session-ops";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const activeNames = (tools: ReturnType<typeof toolsIn>) =>
	tools.tools.filter((tool) => tool.active).map((tool) => tool.name);

describe("listing the tools", () => {
	test("names every tool the session has, with its description and group, and which are on", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const listed = toolsIn(await callTools(t, live.ref));
		const names = listed.tools.map((tool) => tool.name);
		expect(names).toEqual(expect.arrayContaining(["read", "bash", "edit", "write", "ask_human", "driver_hold"]));
		const session = t.world.parts.hosts.session(live.ref.sessionId);
		expect(activeNames(listed).sort()).toEqual([...(session?.getActiveToolNames() ?? [])].sort());
		expect(listed.tools.find((tool) => tool.name === "read")).toMatchObject({ active: true, group: "Built-in" });
		expect(listed.tools.find((tool) => tool.name === "driver_hold")?.group).not.toBe("Built-in");
		expect(listed.tools.every((tool) => tool.description.length > 0)).toBe(true);
		expect(listed.omitted).toBeUndefined();
	});
});

describe("switching a tool", () => {
	test("turns it off and on for the session, as the SDK has it, and the system prompt follows", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const session = t.world.parts.hosts.session(live.ref.sessionId);

		const off = toolsIn(await callTools(t, live.ref, { name: "bash", active: false }));
		expect(off.tools.find((tool) => tool.name === "bash")?.active).toBe(false);
		expect(session?.getActiveToolNames()).not.toContain("bash");
		expect(session?.getActiveToolNames()).toContain("read");
		expect(session?.systemPrompt).not.toContain("- bash:");

		const on = toolsIn(await callTools(t, live.ref, { name: "bash", active: true }));
		expect(on.tools.find((tool) => tool.name === "bash")?.active).toBe(true);
		expect(session?.getActiveToolNames()).toContain("bash");
		expect(session?.systemPrompt).toContain("- bash:");
	});

	test("is refused for a tool the session does not have, and changes nothing", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const session = t.world.parts.hosts.session(live.ref.sessionId);
		const before = session?.getActiveToolNames();
		expect(refusal(await callTools(t, live.ref, { name: "no_such_tool", active: true }))).toStartWith("not_found:");
		expect(session?.getActiveToolNames()).toEqual(before);
	});

	test("is allowed while a run is going", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("Work for a while.");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		const off = toolsIn(await callTools(t, live.ref, { name: "edit", active: false }));
		expect(off.tools.find((tool) => tool.name === "edit")?.active).toBe(false);
		await live.control.abort();
		await live.waitFor("run_finished");
	});

	test("is not saved to settings.json; the next prompt records it in the session file, and a restart restores it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const settingsFile = join(t.world.env.agentDir, "settings.json");
		const settingsBefore = await Bun.file(settingsFile).text();
		const recorded = () =>
			sessionEntries(t?.fileOf(live.ref) ?? "").flatMap((entry) =>
				entry.type === "message" && entry.message.role === "system" ? [entry.message] : [],
			);

		t.router.script(live.ref.sessionId, [say("One.")]);
		await live.run("First, with every tool.");
		expect(recorded().flatMap((message) => message.toolsAdded?.map((tool) => tool.name) ?? [])).toContain("bash");

		await callTools(t, live.ref, { name: "bash", active: false });
		expect(await Bun.file(settingsFile).text()).toBe(settingsBefore);
		expect(recorded().flatMap((message) => message.toolsRemoved ?? [])).toEqual([]);

		t.router.script(live.ref.sessionId, [say("Two.")]);
		await live.run("Second, without bash.");
		expect(recorded().flatMap((message) => message.toolsRemoved?.map((tool) => tool.name) ?? [])).toEqual(["bash"]);
		await live.close();

		await t.rig.restart();
		const reopened = await t.rig.open(live.ref);
		const tools = toolsIn(await callTools(t, reopened.ref));
		expect(tools.tools.find((tool) => tool.name === "bash")?.active).toBe(false);
		expect(tools.tools.find((tool) => tool.name === "read")?.active).toBe(true);
	});
});

describe("a long list", () => {
	test("is cut at the bound with the count of tools left out, and each description is cut with a mark", async () => {
		t = await LiveRig.create({
			settings: {
				extensions: [
					join(import.meta.dir, "helpers", "driver-extension.ts"),
					join(import.meta.dir, "helpers", "many-tools-extension.ts"),
				],
			},
		});
		const live = await t.rig.openNew();
		const listed = toolsIn(await callTools(t, live.ref));
		expect(listed.tools).toHaveLength(MAX_LIST_ITEMS);
		expect(listed.omitted).toBeGreaterThanOrEqual(MANY_TOOLS - MAX_LIST_ITEMS);
		const bulk = listed.tools.find((tool) => tool.name === "bulk_0");
		expect(bulk?.description).toHaveLength(2_048);
		expect(bulk?.description.endsWith("…")).toBe(true);
		expect(LONG_DESCRIPTION.length).toBeGreaterThan(2_048);
	});
});
