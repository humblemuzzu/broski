/**
 * D26 on Broski's own sessions: they load the user's settings, so the installed terminal hook fires for them too. The
 * adapter answers it with no decision, so the CLI's own `canUseTool` raises the ask on the phone as for any session.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expectNoOrphans } from "../spike/rig/orphans";
import { CLI_TEST_MS, type IntegrationRig, pending, startRig } from "./rig";

expectNoOrphans();

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

describe("a session this bridge hosts, with the terminal hook installed", () => {
	test(
		"gets no decision from the hook, and its ask is raised by canUseTool and answered there",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			await claude.terminalAsks.install({
				configDir: claude.home.configDir,
				projectDir: claude.home.projectDir,
				cliPath: claude.cliPath,
				env: claude.env,
				router: claude.router,
			});
			const live = await rig.openNew();
			await rig.arrange(live.ref, { kind: "interaction", interaction: "tool_permission" });
			expect((await live.prompt("Write the file.")).status).toBe("accepted");
			const ask = await pending(live);
			const deadline = Date.now() + 10_000;
			while (!claude.terminalAsks.decisions.has(live.ref.sessionId) && Date.now() < deadline) await Bun.sleep(25);
			expect(claude.terminalAsks.decisions.get(live.ref.sessionId)).toEqual([undefined]);
			const reply = { kind: "tool_permission" as const, optionId: "allow_once", grantIds: [] };
			expect((await live.control.answer({ interactionId: ask.id, reply })).status).toBe("accepted");
			expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
			expect(existsSync(join(claude.home.projectDir, "conformance.txt"))).toBe(true);
			live.assertSettled();
		},
		CLI_TEST_MS,
	);
});
