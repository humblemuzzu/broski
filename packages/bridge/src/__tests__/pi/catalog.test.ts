/**
 * The catalog of a directory as the real `pi` reports it (`catalog/`): its models with what Pi knows of them, its
 * commands, the backend's status, a cache that starts no `pi` while nothing it was read from changed, and reads that
 * leave the agent directory and the project as they found them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createPiParts, piBackendOf } from "../../backends/pi/backend";
import { probeCatalog } from "../../backends/pi/catalog/probe";
import { MIN_PI_VERSION } from "../../backends/pi/cli-version";
import { BackendStatus, type CommandSummary, type ModelSummary } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { HOLDER_COMMAND, MODELS, PI_BIN, wireIdOf } from "./helpers/pi-world";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function models(rig: LiveRig): Promise<Map<string, ModelSummary>> {
	const listed = await rig.backend.listModels(rig.cwd);
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	return new Map(listed.models.map((model) => [model.id, model]));
}

async function commands(rig: LiveRig): Promise<CommandSummary[]> {
	const listed = await rig.backend.listCommands({ cwd: rig.cwd });
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	return listed.commands;
}

/** Every file under `root` with its size and modification time. */
function tree(root: string): string[] {
	return readdirSync(root, { recursive: true, encoding: "utf8" })
		.map((name) => join(root, name))
		.filter((path) => statSync(path).isFile())
		.map((path) => `${relative(root, path)} ${statSync(path).size} ${statSync(path).mtimeMs}`)
		.sort();
}

describe("the models", () => {
	test("are every model Pi can run, under its wire id, with Pi's facts and thinking levels", async () => {
		t = await LiveRig.create();
		const listed = await models(t);
		expect([...listed.keys()]).toEqual(Object.values(MODELS).map(wireIdOf));
		expect(listed.get(wireIdOf(MODELS.reasoner))).toMatchObject({
			displayName: "Scripted Reasoner",
			providerId: "scripted",
			isDefault: true,
			inputModalities: ["text", "image"],
		});
		expect(listed.get(wireIdOf(MODELS.blind))?.inputModalities).toEqual(["text"]);
		const levels = (id: string) => listed.get(wireIdOf(id))?.thinking.options.map((option) => option.value);
		expect(levels(MODELS.reasoner)).toContain("off");
		expect(levels(MODELS.noOff)).not.toContain("off");
		expect(levels(MODELS.noOff)?.length).toBeGreaterThan(0);
		expect(levels(MODELS.plain)).toEqual([]);
		expect([...listed.values()].filter((model) => model.isDefault)).toHaveLength(1);
	});

	test("a model taken out of models.json is gone from the next listing", async () => {
		t = await LiveRig.create();
		expect((await models(t)).has(wireIdOf(MODELS.tiny))).toBe(true);
		const path = join(t.world.env.agentDir, "models.json");
		const config = JSON.parse(readFileSync(path, "utf8"));
		config.providers.scripted.models = config.providers.scripted.models.filter(
			(model: { id: string }) => model.id !== MODELS.tiny,
		);
		writeFileSync(path, JSON.stringify(config));
		expect((await models(t)).has(wireIdOf(MODELS.tiny))).toBe(false);
	});
});

describe("the commands", () => {
	test("are Pi's templates, skills and extension commands, by kind, and never the bridge's own", async () => {
		t = await LiveRig.create();
		const skill = join(t.world.env.agentDir, "skills", "tidy");
		mkdirSync(skill, { recursive: true });
		writeFileSync(join(skill, "SKILL.md"), "---\nname: tidy\ndescription: Tidy up\n---\nPut every file away.\n");
		const listed = await commands(t);
		const byId = new Map(listed.map((command) => [command.id, command]));
		expect(byId.get("prompt:drv-template")).toMatchObject({ kind: "prompt", name: "drv-template" });
		expect(byId.get("ext:drv-ask")).toMatchObject({ kind: "command", name: "drv-ask" });
		expect([...byId.values()].some((command) => command.kind === "skill" && command.name.endsWith("tidy"))).toBe(true);
		expect(listed.some((command) => command.name === "broski-host")).toBe(false);
		expect(new Set(listed.map((command) => command.id)).size).toBe(listed.length);
	});
});

describe("the cache", () => {
	test("starts no pi while nothing the catalog was read from changed, and one once something did", async () => {
		t = await LiveRig.create();
		await models(t);
		const probes = t.world.probes();
		await commands(t);
		await models(t);
		expect(t.world.probes()).toBe(probes);

		writeFileSync(join(t.world.env.agentDir, "prompts", "fresh.md"), "---\ndescription: new\n---\nnew\n");
		expect((await commands(t)).some((command) => command.id === "prompt:fresh")).toBe(true);
		expect(t.world.probes()).toBe(probes + 1);
	});
});

describe("reading the catalog", () => {
	// Any `pi` writes an empty `auth.json` and `models-store.json` at its first start (pi-coding-agent 1.5.2).
	test("models, status and commands leave the project as they found it, and the agent directory but for Pi's own first files", async () => {
		t = await LiveRig.create();
		const { agentDir } = t.world.env;
		const before = [tree(agentDir), tree(t.cwd)];
		await models(t);
		await commands(t);
		expect(BackendStatus.safeParse(await t.backend.status()).success).toBe(true);
		const firstFiles = ["auth.json", "models-store.json"];
		const after = tree(agentDir).filter((line) => !firstFiles.some((name) => line.startsWith(`${name} `)));
		expect([after, tree(t.cwd)]).toEqual(before);
		for (const name of firstFiles) expect(JSON.parse(readFileSync(join(agentDir, name), "utf8"))).toEqual({});
	});
});

describe("the status", () => {
	test("with a model to run, Pi is installed, signed in and usable, with its version and nothing to report", async () => {
		t = await LiveRig.create();
		const status = await t.backend.status();
		expect(status).toMatchObject({ installed: true, auth: "signed_in", usable: true, issues: [] });
		expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("with no model to run, Pi is signed out and not usable, and says what to do", async () => {
		t = await LiveRig.create();
		writeFileSync(join(t.world.env.agentDir, "models.json"), JSON.stringify({ providers: {} }));
		const status = await t.backend.status();
		expect(status).toMatchObject({ installed: true, auth: "signed_out", usable: false });
		expect(status.issues.map((issue) => issue.message).join("\n")).toContain("/login");
	});

	test("a pi older than the oldest this bridge runs as intended is a warning naming both versions", async () => {
		t = await LiveRig.create();
		const old = join(t.world.env.root, "old-pi");
		writeFileSync(old, "#!/bin/sh\necho 1.4.0\n");
		chmodSync(old, 0o755);
		const parts = createPiParts(
			{ catalog: { emit: () => {} } },
			{
				install: { cli: { found: true, path: old }, env: t.world.env.env(), agentDir: t.world.env.agentDir },
				hostDir: join(t.world.env.root, "old-host"),
				holders: { root: t.world.holdersRoot, command: HOLDER_COMMAND },
			},
		);
		const backend = piBackendOf(parts);
		try {
			const status = await backend.status();
			const warning = status.issues.find((issue) => issue.message.includes("1.4.0"));
			expect(warning).toMatchObject({ severity: "warning" });
			expect(warning?.message).toContain(MIN_PI_VERSION);
		} finally {
			await backend.dispose();
		}
	});

	test("a pi that cannot be found is not installed, and says how to point the bridge at it", async () => {
		t = await LiveRig.create();
		const parts = createPiParts(
			{ catalog: { emit: () => {} } },
			{
				install: {
					cli: { found: false, reason: "pi was not found on PATH; set pi.cliPath in the bridge's config" },
					env: t.world.env.env(),
					agentDir: t.world.env.agentDir,
				},
				hostDir: join(t.world.env.root, "missing-host"),
				holders: { root: t.world.holdersRoot, command: HOLDER_COMMAND },
			},
		);
		const backend = piBackendOf(parts);
		try {
			expect(await backend.status()).toMatchObject({
				installed: false,
				usable: false,
				issues: [{ severity: "error", message: expect.stringContaining("pi.cliPath") }],
			});
		} finally {
			await backend.dispose();
		}
	});
});

describe("the probe a catalog is read with", () => {
	/** The catalog of the world's project, read with a user's extension whose `session_start` does `body`. */
	async function probedWith(rig: LiveRig, body: string) {
		const folder = join(rig.world.env.agentDir, "extensions");
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "starts.ts"), `export default function (pi) {\n${body}\n}\n`);
		const { env, agentDir } = rig.world.env;
		return probeCatalog({ cli: { found: true, path: PI_BIN }, env: env(), agentDir }, rig.cwd);
	}

	test("fails at once, naming it, when an extension asks a human while Pi starts", async () => {
		t = await LiveRig.create();
		const began = performance.now();
		const read = await probedWith(
			t,
			`pi.on("session_start", async (_event, ctx) => { await ctx.ui.select("Trust this folder?", ["yes", "no"]); });`,
		);
		expect(read).toEqual({ failure: expect.stringContaining('"Trust this folder?"') });
		expect(performance.now() - began).toBeLessThan(10_000);
	});

	test("reads on past a status line and a notice, which ask nothing", async () => {
		t = await LiveRig.create();
		const read = await probedWith(
			t,
			`pi.on("session_start", (_event, ctx) => { ctx.ui.setStatus("k", "busy"); ctx.ui.notify("hello", "info"); });`,
		);
		expect(read).not.toHaveProperty("failure");
		expect(read).toMatchObject({ thinking: expect.any(String) });
	});
});
