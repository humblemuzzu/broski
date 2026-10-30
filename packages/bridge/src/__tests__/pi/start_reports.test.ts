/**
 * What Pi's terminal reports when it starts reaches the phone: a session's start problems as notices right after
 * its open, the user's `enabledModels` problems in the backend's status.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SinkRecord } from "../../contract";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("a session's start problems", () => {
	test("an extension that fails to load is an error notice, sent once the open has resolved", async () => {
		t = await LiveRig.create();
		const extensions = join(t.world.env.agentDir, "extensions");
		mkdirSync(extensions, { recursive: true });
		writeFileSync(join(extensions, "broken.ts"), "throw new Error('this extension cannot load');\n");
		const records: SinkRecord[] = [];
		const opened = await t.backend.open(
			{ kind: "new", options: { cwd: t.cwd } },
			{ emit: (record) => records.push(record) },
		);
		expect(opened.status).toBe("accepted");
		expect(records).toEqual([]);

		await new Promise((resolve) => setImmediate(resolve));
		const notices = records.flatMap((record) => (record.event.type === "notice" ? [record.event] : []));
		expect(notices).toContainEqual(
			expect.objectContaining({ level: "error", text: expect.stringContaining("this extension cannot load") }),
		);
		expect(notices.find((notice) => notice.text.includes("cannot load"))?.text).toContain("Failed to load extension");
	});
});

describe("a session's settings Pi cannot read", () => {
	test("are a warning notice, as the terminal words it", async () => {
		t = await LiveRig.create();
		mkdirSync(join(t.cwd, ".pi"), { recursive: true });
		const broken = join(t.cwd, ".pi", "settings.json");
		writeFileSync(broken, "{ not json");
		new ProjectTrustStore(t.world.env.agentDir).set(t.cwd, true);
		const live = await t.rig.openNew();
		const notice = await live.waitFor("notice", (event) => event.text.startsWith("Invalid settings file"));
		expect(notice).toMatchObject({ level: "warning", text: expect.stringContaining(broken) });
	});
});

describe("the backend's status", () => {
	test("warns about an enabledModels pattern that matches no model, as the terminal does at its start", async () => {
		t = await LiveRig.create({ settings: { enabledModels: ["no-such-model-anywhere"] } });
		const status = await t.backend.status();
		expect(status.usable).toBe(true);
		expect(status.issues).toContainEqual({
			severity: "warning",
			message: expect.stringContaining("no-such-model-anywhere"),
		});
	});
});

describe("reading Pi's settings", () => {
	test("waits for no lock a terminal holds on settings.json, where Pi's own reader spins and fails, and reads it all", async () => {
		t = await LiveRig.create();
		const lock = join(t.world.env.agentDir, "settings.json.lock");
		mkdirSync(lock);
		const models = await t.backend.listModels(t.cwd);
		const commands = await t.backend.listCommands({ cwd: t.cwd });
		const status = await t.backend.status();
		expect(models.status === "accepted" && models.models.find((model) => model.isDefault)?.id).toBe(
			wireIdOf(FAUX_MODEL_IDS.reasoner),
		);
		expect(commands.status).toBe("accepted");
		expect(status.usable).toBe(true);

		const piBegan = performance.now();
		const pis = SettingsManager.create(t.cwd, t.world.env.agentDir);
		expect(performance.now() - piBegan).toBeGreaterThanOrEqual(150);
		expect(pis.drainErrors().map((error) => error.scope)).toContain("global");
	});
});

describe("a project nobody has trusted", () => {
	test("says its resources were left out, as the terminal says it; once trusted, nothing is said", async () => {
		t = await LiveRig.create();
		mkdirSync(join(t.cwd, ".pi", "prompts"), { recursive: true });
		const untrusted = await t.rig.openNew();
		const warning = await untrusted.waitFor("notice", (event) => event.text.includes("not trusted"));
		expect(warning.level).toBe("warning");
		expect(warning.text).toContain(".pi resources and packages are ignored");

		new ProjectTrustStore(t.world.env.agentDir).set(t.cwd, true);
		const records: SinkRecord[] = [];
		const trusted = await t.backend.open({ kind: "new", options: { cwd: t.cwd } }, { emit: (r) => records.push(r) });
		expect(trusted.status).toBe("accepted");
		await new Promise((resolve) => setImmediate(resolve));
		expect(records.some((record) => record.event.type === "notice" && record.event.text.includes("trusted"))).toBe(
			false,
		);
	});
});

describe("a project's own enabledModels", () => {
	test("a pattern that matches no model is a warning notice of the session, as the terminal prints it", async () => {
		t = await LiveRig.create();
		mkdirSync(join(t.cwd, ".pi"), { recursive: true });
		writeFileSync(join(t.cwd, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["nothing-like-this"] }));
		new ProjectTrustStore(t.world.env.agentDir).set(t.cwd, true);
		const live = await t.rig.openNew();
		const notice = await live.waitFor("notice", (event) => event.text.includes("nothing-like-this"));
		expect(notice.level).toBe("warning");
	});
});

describe("a session started again", () => {
	test("reports only the problems its last start did not", async () => {
		t = await LiveRig.create();
		const extensions = join(t.world.env.agentDir, "extensions");
		mkdirSync(extensions, { recursive: true });
		writeFileSync(join(extensions, "broken.ts"), "throw new Error('the first broken one');\n");
		const live = await t.rig.openNew();
		await live.waitFor("notice", (event) => event.text.includes("the first broken one"));
		await live.close();
		await t.bus.shutDown(live.ref.sessionId);

		writeFileSync(join(extensions, "also-broken.ts"), "throw new Error('the second broken one');\n");
		const again = await t.rig.open(live.ref);
		await again.waitFor("notice", (event) => event.text.includes("the second broken one"));
		await new Promise((resolve) => setImmediate(resolve));
		const texts = again.events().flatMap((event) => (event.type === "notice" ? [event.text] : []));
		expect(texts.some((text) => text.includes("the first broken one"))).toBe(false);
	});
});
