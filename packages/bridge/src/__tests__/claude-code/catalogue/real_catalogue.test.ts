/**
 * The catalogue against the real bundled CLI 2.1.316 (D32): what its models, commands, modes and status really are
 * offline, that a probe leaves no process and sends no request, and that the facts the code relies on still hold.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKControlInitializeResponse, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { isRejected } from "../../../backends/claude-code/rejections";
import { EXPECTED_CLAUDE_CLI_VERSION } from "../../../server/claude-code-backend";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import {
	CLI_TEST_MS,
	type RealWorld,
	startRealWorld,
	writeProjectCommand,
	writeProjectSettings,
	writeProjectSkill,
} from "./real-world";

expectNoOrphans();

const worlds: RealWorld[] = [];
afterEach(async () => {
	for (const world of worlds.splice(0)) {
		expect(world.server.escapes()).toEqual([]);
		expect(world.server.requests()).toEqual([]);
		await world.stop();
	}
});

function world(...args: Parameters<typeof startRealWorld>): RealWorld {
	const made = startRealWorld(...args);
	worlds.push(made);
	return made;
}

async function initOf(w: RealWorld): Promise<SDKControlInitializeResponse> {
	const init = await w.catalogue.initialize(w.home.projectDir);
	if (isRejected(init)) throw new Error(init.rejection.message);
	return init;
}

describe("models and thinking", () => {
	test(
		"the built-in rows list in the CLI's order with effort low to max, one default, and no model twice",
		async () => {
			const w = world();
			const init = await initOf(w);
			const listed = await w.catalogue.models(w.home.projectDir);
			if (listed.status !== "accepted") throw new Error("not listed");
			expect(listed.models.map((model) => model.id)).toEqual(["default", "fable", "sonnet", "haiku"]);
			expect(listed.models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["default"]);
			for (const model of listed.models) {
				expect(model.thinking.options.map((option) => option.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
			}
			const wire = (id: string) => init.models.find((row) => row.value === id)?.resolvedModel;
			const [first, second] = listed.models;
			expect(wire(first?.id ?? "")).not.toBe(wire(second?.id ?? ""));
			expect(new Set(listed.models.map((model) => wire(model.id))).size).toBe(listed.models.length);
			expect(init.models.map((row) => row.value)).toEqual(["default", "opus", "fable", "sonnet", "haiku"]);
			expect(wire("default")).toBe(wire("opus"));
			expect(await w.catalogue.listedModelId(w.home.projectDir, wire("opus") ?? "")).toBe("default");
			expect(await w.catalogue.listedModelId(w.home.projectDir, wire("sonnet") ?? "")).toBe("sonnet");
		},
		CLI_TEST_MS,
	);

	test(
		"a model that does not exist is not listed, and the permissions axis offers all six modes",
		async () => {
			const w = world();
			expect(await w.catalogue.model(w.home.projectDir, "claude-opus-4-1")).toBeUndefined();
			const modes = await w.catalogue.modes(w.home.projectDir);
			if (modes.status !== "accepted") throw new Error("not listed");
			expect(modes.modes.map((axis) => axis.id)).toEqual(["permissions"]);
			expect(modes.modes[0]?.options.map((option) => option.value)).toEqual([
				"default",
				"acceptEdits",
				"plan",
				"auto",
				"dontAsk",
				"bypassPermissions",
			]);
		},
		CLI_TEST_MS,
	);
});

describe("commands", () => {
	test(
		"a project command and skill lead the list, skills are marked, and no terminal-bound command is listed",
		async () => {
			const w = world({}, (home) => {
				writeProjectCommand(home, "conformance", "Reply with the word CONFORMANCE. $ARGUMENTS\n");
				writeProjectSkill(home, "demo", "A demo skill");
			});
			const listed = await w.catalogue.commands(w.home.projectDir);
			if (listed.status !== "accepted") throw new Error("not listed");
			const ids = listed.commands.map((command) => command.id);
			expect(ids.slice(0, 2).sort()).toEqual(["conformance", "demo"]);
			expect(listed.commands.find((command) => command.id === "demo")?.kind).toBe("skill");
			expect(listed.commands.find((command) => command.id === "dataviz")?.kind).toBe("skill");
			expect(listed.commands.find((command) => command.id === "compact")?.kind).toBe("command");
			expect(listed.commands.find((command) => command.id === "debug")?.argumentHint).toBe("[issue description]");
			expect(new Set(ids).size).toBe(ids.length);
		},
		CLI_TEST_MS,
	);

	test(
		"lists exactly what a real turn's init frame calls a slash command, minus its terminal_slash_commands",
		async () => {
			const w = world({}, (home) => {
				writeProjectCommand(home, "conformance", "Reply with the word CONFORMANCE. $ARGUMENTS\n");
				writeProjectSkill(home, "demo", "A demo skill");
			});
			const listed = await w.catalogue.commands(w.home.projectDir);
			if (listed.status !== "accepted") throw new Error("not listed");
			const spike = startSpike({ permissionMode: "default", turns: [{ text: ["ok"] }], home: w.home });
			try {
				spike.send("hello");
				await spike.waitFor((message) => message.type === "result");
				await spike.waitFor(isIdle);
				const init = spike.messages.find(isInit);
				if (!init) throw new Error("no init frame");
				const terminal = init.terminal_slash_commands ?? [];
				expect(terminal.length).toBeGreaterThan(0);
				const expected = init.slash_commands.filter((name) => !terminal.includes(name)).sort();
				expect(listed.commands.map((command) => command.id).sort()).toEqual(expected);
				expect(spike.server.escapes()).toEqual([]);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});

function isInit(message: SDKMessage): message is Extract<SDKMessage, { type: "system"; subtype: "init" }> {
	return message.type === "system" && message.subtype === "init";
}

describe("the probe", () => {
	test(
		"runs no project hook and writes no session",
		async () => {
			const marker = (home: { root: string }) => join(home.root, "hook-ran.txt");
			const w = world({}, (home) => {
				const command = `echo ran >> ${marker(home)}`;
				writeProjectSettings(home, { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } });
			});
			const listed = await w.catalogue.models(w.home.projectDir);
			expect(listed.status).toBe("accepted");
			await Bun.sleep(300);
			expect(existsSync(marker(w.home))).toBe(false);
			const projects = join(w.home.configDir, "projects");
			expect(existsSync(projects) ? readdirSync(projects) : []).toEqual([]);
		},
		CLI_TEST_MS,
	);

	test(
		"a restart answers from <stateDir>/catalog.json without starting a CLI",
		async () => {
			const w = world();
			await w.catalogue.models(w.home.projectDir);
			expect(w.started).toHaveLength(1);
			const restarted = w.restart();
			const listed = await restarted.models(w.home.projectDir);
			expect(listed.status).toBe("accepted");
			expect(w.started).toHaveLength(1);
		},
		CLI_TEST_MS,
	);
});

describe("status", () => {
	test(
		"ok: signed in by an API key, the bundled version, usable, no issues",
		async () => {
			const w = world({ expectedCliVersion: EXPECTED_CLAUDE_CLI_VERSION });
			expect(await w.catalogue.status()).toEqual({
				installed: true,
				version: EXPECTED_CLAUDE_CLI_VERSION,
				auth: "signed_in",
				usable: true,
				issues: [],
			});
			expect(w.started[0]?.options.cwd).toBe(w.services.stateDir);
		},
		CLI_TEST_MS,
	);

	test(
		"version mismatch: a warning that names both versions, still usable",
		async () => {
			const w = world({ expectedCliVersion: "2.1.400" });
			const status = await w.catalogue.status();
			expect(status.usable).toBe(true);
			expect(status.issues).toHaveLength(1);
			expect(status.issues[0]?.severity).toBe("warning");
			expect(status.issues[0]?.message).toContain(EXPECTED_CLAUDE_CLI_VERSION);
			expect(status.issues[0]?.message).toContain("2.1.400");
		},
		CLI_TEST_MS,
	);

	test(
		"signed out: no key and an empty home read as signed_out, not usable",
		async () => {
			const w = world({ signedOut: true });
			const status = await w.catalogue.status();
			expect(status).toMatchObject({
				installed: true,
				version: EXPECTED_CLAUDE_CLI_VERSION,
				auth: "signed_out",
				usable: false,
			});
			expect(status.issues[0]).toMatchObject({ severity: "error" });
			expect(status.issues[0]?.message).toContain("not signed in");
		},
		CLI_TEST_MS,
	);

	test(
		"a startup refusal (a proxy that is not a URL) is reported by its reason, and every read is rejected",
		async () => {
			const w = world({ env: { HTTPS_PROXY: "not a url" } });
			const status = await w.catalogue.status();
			expect(status).toMatchObject({ installed: true, auth: "unknown", usable: false });
			expect(status.issues).toEqual([
				{
					severity: "error",
					message: "A proxy setting (HTTPS_PROXY, HTTP_PROXY or similar) is not a complete URL.",
				},
			]);
			const listed = await w.catalogue.models(w.home.projectDir);
			expect(listed.status === "rejected" && listed.rejection.code).toBe("backend_error");
		},
		CLI_TEST_MS,
	);

	test(
		"a global config file that is not JSON is reported with its path and how to repair it, and left as it is",
		async () => {
			const w = world({}, (home) => writeFileSync(join(home.configDir, ".claude.json"), "{ broken"));
			const file = join(w.home.configDir, ".claude.json");
			const status = await w.catalogue.status();
			expect(status).toMatchObject({ installed: true, auth: "unknown", usable: false });
			expect(status.issues).toEqual([
				{
					severity: "error",
					message: `Claude Code will not start: its configuration file ${file} is not valid JSON. Fix the JSON in that file, or move it aside to start with default settings.`,
				},
			]);
			expect(readFileSync(file, "utf8")).toBe("{ broken");
		},
		CLI_TEST_MS,
	);

	test(
		"a binary that is gone since it was found: not usable, and the issue says it was not found",
		async () => {
			const w = world({ cliPath: "/nonexistent/claude" });
			const status = await w.catalogue.status();
			expect(status).toMatchObject({ installed: true, usable: false });
			expect(status.issues[0]?.message).toContain("not found");
		},
		CLI_TEST_MS,
	);
});
