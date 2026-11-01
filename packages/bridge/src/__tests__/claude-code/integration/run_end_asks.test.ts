/**
 * Lanes D and E meet, through the whole adapter and the real CLI: an ask belongs to the run that raised it, a Stop
 * withdraws it before the run ends, the server's own completion of a URL ask withdraws it, and a plan approval
 * offers the catalogue's modes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Scenario } from "../../../contract/testing/conformance-types";
import { expectNoOrphans } from "../spike/rig/orphans";
import { devClaudeBinary, processesOf } from "../spike/rig/processes";
import { CLI_TEST_MS, type IntegrationRig, pending, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

async function askIn(scenario: Scenario) {
	world = await startRig();
	const { rig } = world;
	const live = await rig.openNew();
	await rig.arrange(live.ref, scenario);
	expect((await live.prompt("Go.")).status).toBe("accepted");
	const started = await live.waitFor("run_started");
	return { rig, live, started, ask: await pending(live) };
}

describe("asks and the run around them", () => {
	test(
		"an ask blocks the run that raised it, and a Stop withdraws it before that run ends aborted",
		async () => {
			const { live, started, ask } = await askIn({ kind: "interaction", interaction: "tool_permission" });
			expect(ask).toMatchObject({ runId: started.runId, blocksRun: true });
			expect((await live.control.abort()).status).toBe("accepted");
			const finished = await live.waitFor("run_finished");
			expect(finished.outcome.kind).toBe("aborted");
			const types = live.events().map((event) => event.type);
			const withdrawn = live
				.events()
				.findIndex((event) => event.type === "interaction_resolved" && event.interactionId === ask.id);
			expect(withdrawn).toBeGreaterThan(-1);
			expect(live.events()[withdrawn]).toMatchObject({ reason: "withdrawn" });
			expect(withdrawn).toBeLessThan(types.lastIndexOf("run_finished"));
			live.assertSettled();
		},
		CLI_TEST_MS,
	);

	test(
		"a CLI that dies under a pending ask ends it without an answer, and the run ends unavailable, not hanging",
		async () => {
			const before = new Set(processesOf(devClaudeBinary()));
			const { live, ask } = await askIn({ kind: "interaction", interaction: "tool_permission" });
			const started = processesOf(devClaudeBinary()).filter((pid) => !before.has(pid));
			expect(started.length).toBeGreaterThan(0);
			for (const pid of started) process.kill(pid, "SIGKILL");
			const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === ask.id);
			expect(["withdrawn", "expired"]).toContain(resolved.reason);
			const finished = await live.waitFor("run_finished");
			expect(finished.outcome).toMatchObject({ kind: "error", error: { code: "backend_unavailable" } });
			live.assertSettled();
		},
		CLI_TEST_MS,
	);

	test(
		"a URL ask the server completes while nobody answered is withdrawn, and the run goes on",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const live = await rig.openNew();
			claude.router.replace(live.ref.sessionId, [
				{ toolCalls: [{ name: "mcp__elicit__ask_url_completed", args: {} }] },
				{ text: ["Done."] },
			]);
			expect((await live.prompt("Go.")).status).toBe("accepted");
			const ask = await pending(live);
			expect(ask.request.kind).toBe("external_url");
			const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === ask.id);
			expect(resolved.reason).toBe("withdrawn");
			expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
			live.assertSettled();
		},
		CLI_TEST_MS,
	);

	test(
		"a plan approval offers the catalogue's permission modes, plan left out, to choose the next one",
		async () => {
			const { rig, live, ask } = await askIn({ kind: "interaction", interaction: "plan_approval" });
			const listed = await rig.backend.listModes(rig.driver.cwd);
			if (listed.status !== "accepted") throw new Error("modes not listed");
			const modes = listed.modes.find((axis) => axis.id === "permissions")?.options.map((option) => option.value);
			expect(ask.request.kind).toBe("plan_approval");
			const offered = ask.request.kind === "plan_approval" ? ask.request.modeOptions : undefined;
			expect(offered?.options.map((option) => option.value)).toEqual(modes?.filter((mode) => mode !== "plan"));
			expect(offered?.defaultValue).toBe("default");
			expect((await live.control.abort()).status).toBe("accepted");
			await live.waitFor("run_finished");
		},
		CLI_TEST_MS,
	);
});
