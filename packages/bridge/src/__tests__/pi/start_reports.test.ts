/**
 * What reaches the phone when Pi cannot start a session as asked. In RPC mode Pi reports its start problems on no
 * channel but its exit: an extension that fails to load ends `pi` with the reason on stderr, and the open is refused
 * with that reason. A settings lock a terminal holds stops none of the bridge's reads; the catalog is what Pi reads
 * past it, without the settings it could not read.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { LiveRig } from "./helpers/live-rig";
import { MODELS, wireIdOf } from "./helpers/pi-world";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("an extension that fails to load", () => {
	test("refuses the open with Pi's own reason, and leaves no pi behind", async () => {
		t = await LiveRig.create();
		const extensions = join(t.world.env.agentDir, "extensions");
		mkdirSync(extensions, { recursive: true });
		writeFileSync(join(extensions, "broken.ts"), "throw new Error('this extension cannot load');\n");
		const opened = await t.backend.open({ kind: "new", options: { cwd: t.cwd } }, { emit: () => {} });
		expect(opened).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(opened.status === "rejected" && opened.rejection.message).toContain("this extension cannot load");
		expect(t.world.sessionProcesses()).toBe(0);
	});
});

describe("reading Pi's settings", () => {
	test("waits for no lock a terminal holds on settings.json, where Pi's own reader spins and fails", async () => {
		t = await LiveRig.create();
		const lock = join(t.world.env.agentDir, "settings.json.lock");
		mkdirSync(lock);
		const models = await t.backend.listModels(t.cwd);
		const commands = await t.backend.listCommands({ cwd: t.cwd });
		const status = await t.backend.status();
		expect(models.status === "accepted" && models.models.map((model) => model.id)).toContain(wireIdOf(MODELS.reasoner));
		expect(commands.status).toBe("accepted");
		expect(status.usable).toBe(true);

		const piBegan = performance.now();
		const pis = SettingsManager.create(t.cwd, t.world.env.agentDir);
		expect(performance.now() - piBegan).toBeGreaterThanOrEqual(150);
		expect(pis.drainErrors().map((error) => error.scope)).toContain("global");
	});
});
