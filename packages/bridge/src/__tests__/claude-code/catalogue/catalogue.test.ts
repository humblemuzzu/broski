import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_MAX_AGE_MS } from "../../../backends/claude-code/models/catalog-cache";
import { PROBE_TIMEOUT_MS } from "../../../backends/claude-code/process/probe";
import { isRejected } from "../../../backends/claude-code/rejections";
import { FakeQuery } from "../helpers/fake-query";
import {
	catalogueRig,
	command,
	failingQuery,
	initAnswer,
	probeQuery,
	type Rig,
	type RigOptions,
	refusalQuery,
} from "./rig";

const rigs: Rig[] = [];
afterEach(() => {
	for (const rig of rigs.splice(0)) rig.dispose();
});

function rigOf(options: RigOptions = {}): Rig {
	const rig = catalogueRig(options);
	rigs.push(rig);
	return rig;
}

function scripted(count: number, skills: string[] = []): FakeQuery[] {
	return Array.from({ length: count }, () => probeQuery(initAnswer(), skills));
}

describe("the probe", () => {
	test("starts one CLI with an empty inbox, no hooks and no session file, and closes it", async () => {
		const [query] = scripted(1, ["demo"]);
		if (!query) throw new Error("no query");
		const rig = rigOf({ queries: [query] });
		const listed = await rig.catalogue.models("/project");
		expect(listed.status).toBe("accepted");
		expect(rig.sdk.started).toHaveLength(1);
		const started = rig.sdk.started[0];
		expect(started?.options).toMatchObject({
			cwd: "/project",
			pathToClaudeCodeExecutable: "/fake/claude",
			permissionMode: "default",
			persistSession: false,
			settings: { disableAllHooks: true },
		});
		expect(started?.options.env).toMatchObject({
			CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
			CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
			CLAUDE_AGENT_SDK_CLIENT_APP: "broski/test",
		});
		expect(query.closed).toBe(true);
		expect(query.calls.map((call) => call.method)).toEqual(["initializationResult", "reloadSkills", "close"]);
	});

	test("reads no prompt: the inbox it passes yields nothing and ends with the probe", async () => {
		const rig = rigOf({ queries: scripted(1) });
		await rig.catalogue.models("/project");
		const iterator = rig.sdk.started[0]?.prompt[Symbol.asyncIterator]();
		expect(await iterator?.next()).toEqual({ done: true, value: undefined });
	});

	test("runs in a folder of its own when no cwd is named, never in the user's home", async () => {
		const rig = rigOf({ queries: scripted(1) });
		await rig.catalogue.models(undefined);
		expect(rig.sdk.started[0]?.options.cwd).toBe(rig.stateDir);
	});

	test("a skills request that fails leaves every command a command, and is not asked again", async () => {
		const noSkills = new FakeQuery({ initializationResult: async () => initAnswer({ commands: [command("demo")] }) });
		const rig = rigOf({ queries: [noSkills] });
		for (let again = 0; again < 2; again++) {
			const listed = await rig.catalogue.commands("/project");
			expect(listed.status === "accepted" && listed.commands.map((entry) => entry.kind)).toEqual(["command"]);
		}
		expect(rig.sdk.started).toHaveLength(1);
	});
});

describe("the cache", () => {
	test("answers models, commands and modes of one cwd from one probe", async () => {
		const rig = rigOf({ queries: scripted(2) });
		await rig.catalogue.models("/project");
		await rig.catalogue.commands("/project");
		await rig.catalogue.modes("/project");
		await rig.catalogue.model("/project", "sonnet");
		await rig.catalogue.listedModelId("/project", "claude-sonnet-5-5");
		await rig.catalogue.initialize("/project");
		expect(rig.sdk.started).toHaveLength(1);
		await rig.catalogue.models("/other");
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("shares one probe between concurrent requests for a cwd", async () => {
		const rig = rigOf({ queries: scripted(3) });
		const all = await Promise.all([
			rig.catalogue.models("/p"),
			rig.catalogue.commands("/p"),
			rig.catalogue.modes("/p"),
			rig.catalogue.initialize("/p"),
		]);
		expect(all.every((result) => !isRejected(result))).toBe(true);
		expect(rig.sdk.started).toHaveLength(1);
	});

	test("survives a restart through <stateDir>/catalog.json, and asks again after 24 hours", async () => {
		const rig = rigOf({ queries: scripted(3) });
		await rig.catalogue.models("/p");
		expect(existsSync(join(rig.stateDir, "catalog.json"))).toBe(true);
		const restarted = rig.restart();
		const listed = await restarted.models("/p");
		expect(listed.status).toBe("accepted");
		expect(rig.sdk.started).toHaveLength(1);
		rig.clock.advance(CATALOG_MAX_AGE_MS + 1);
		await restarted.models("/p");
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("invalidate drops one cwd or all, tells the app of all three lists, and the next read probes again", async () => {
		const rig = rigOf({ queries: scripted(6) });
		await rig.catalogue.models("/a");
		await rig.catalogue.models("/b");
		rig.catalogue.invalidate("/a");
		expect(rig.events).toEqual([
			{ type: "catalog_invalidated", scope: "models" },
			{ type: "catalog_invalidated", scope: "commands" },
			{ type: "catalog_invalidated", scope: "modes" },
		]);
		await rig.catalogue.models("/b");
		expect(rig.sdk.started).toHaveLength(2);
		await rig.catalogue.models("/a");
		expect(rig.sdk.started).toHaveLength(3);
		rig.catalogue.invalidate();
		await rig.catalogue.models("/a");
		await rig.catalogue.models("/b");
		expect(rig.sdk.started).toHaveLength(5);
		expect(rig.events).toHaveLength(6);
	});

	test("an answer that was on its way when the cache was invalidated is returned but not kept", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow = probeQuery(initAnswer());
		const slowInit = slow.initializationResult.bind(slow);
		slow.initializationResult = async () => {
			await gate;
			return slowInit();
		};
		const rig = rigOf({ queries: [slow, ...scripted(2)] });
		const pending = rig.catalogue.models("/p");
		await Bun.sleep(20);
		rig.catalogue.invalidate("/p");
		release();
		expect((await pending).status).toBe("accepted");
		await rig.catalogue.models("/p");
		expect(rig.sdk.started).toHaveLength(2);
	});
});

describe("observe", () => {
	test("a host's answer refreshes the cache without starting a CLI", async () => {
		const rig = rigOf({ queries: scripted(2) });
		await rig.catalogue.models("/p");
		const changed = initAnswer({ models: [{ value: "only", displayName: "Only", description: "d" }] });
		rig.catalogue.observe("/p", changed);
		const listed = await rig.catalogue.models("/p");
		expect(listed.status === "accepted" && listed.models.map((model) => model.id)).toEqual(["only"]);
		expect(rig.sdk.started).toHaveLength(1);
		const restarted = await rig.restart().models("/p");
		expect(restarted.status === "accepted" && restarted.models.map((model) => model.id)).toEqual(["only"]);
	});

	test("keeps the skills a probe found; an entry made by a host alone gets them from one probe", async () => {
		const hosted = initAnswer({ commands: [command("demo"), command("conformance")] });
		const rig = rigOf({ queries: [probeQuery(initAnswer(), ["conformance"]), probeQuery(hosted, ["demo"])] });
		const kindOf = async (cwd: string, id: string) => {
			const listed = await rig.catalogue.commands(cwd);
			return listed.status === "accepted" ? listed.commands.find((entry) => entry.id === id)?.kind : undefined;
		};
		expect(await kindOf("/probed", "conformance")).toBe("skill");
		rig.catalogue.observe("/probed", initAnswer());
		expect(await kindOf("/probed", "conformance")).toBe("skill");
		expect(rig.sdk.started).toHaveLength(1);

		rig.catalogue.observe("/hosted", initAnswer({ commands: [command("demo"), command("conformance")] }));
		const models = await rig.catalogue.models("/hosted");
		expect(models.status).toBe("accepted");
		expect(rig.sdk.started).toHaveLength(1);
		expect(await kindOf("/hosted", "demo")).toBe("skill");
		expect(rig.sdk.started).toHaveLength(2);
		expect(await kindOf("/hosted", "conformance")).toBe("command");
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("commands fall back to the host's answer when the skills probe fails", async () => {
		const rig = rigOf({ queries: [failingQuery("boom")] });
		rig.catalogue.observe("/hosted", initAnswer({ commands: [command("demo")] }));
		const listed = await rig.catalogue.commands("/hosted");
		expect(listed.status === "accepted" && listed.commands.map((entry) => [entry.id, entry.kind])).toEqual([
			["demo", "command"],
		]);
	});
});

describe("model lookups", () => {
	test("model() finds a listed model, and is undefined for one the list does not offer", async () => {
		const rig = rigOf({ queries: scripted(1) });
		const found = await rig.catalogue.model("/p", "opus");
		expect(found && !isRejected(found) && found.id).toBe("opus");
		expect(await rig.catalogue.model("/p", "claude-opus-4-1")).toBeUndefined();
		expect(await rig.catalogue.model("/p", "not-a-model")).toBeUndefined();
	});

	test("listedModelId() names the row a wire model runs as", async () => {
		const rig = rigOf({ queries: scripted(1) });
		expect(await rig.catalogue.listedModelId("/p", "claude-haiku-5-5")).toBe("haiku");
		expect(await rig.catalogue.listedModelId("/p", "claude-opus-5-5")).toBe("default");
		expect(await rig.catalogue.listedModelId("/p", "claude-retired-1")).toBeUndefined();
	});

	test("includeUnavailable lists what the plain list does: the SDK types no unavailable models", async () => {
		const rig = rigOf({ queries: scripted(1) });
		const plain = await rig.catalogue.models("/p");
		expect(await rig.catalogue.models("/p", { includeUnavailable: true })).toEqual(plain);
	});
});

describe("failures are values", () => {
	test("a CLI that cannot start is a backend_error that says why, never cached, and its process is closed", async () => {
		const failing = failingQuery("Claude Code process exited with code 1. stderr: boom");
		const rig = rigOf({ queries: [failing, probeQuery(initAnswer())] });
		const first = await rig.catalogue.models("/p");
		expect(first.status === "rejected" && first.rejection.code).toBe("backend_error");
		expect(first.status === "rejected" && first.rejection.message).toContain("boom");
		expect(failing.closed).toBe(true);
		expect((await rig.catalogue.models("/p")).status).toBe("accepted");
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("a known refusal is told in its own words; one that needs a sign-in is an auth rejection", async () => {
		const rig = rigOf({ queries: [refusalQuery("proxy_invalid"), refusalQuery("org_config_refused")] });
		const proxy = await rig.catalogue.models("/p");
		expect(proxy.status === "rejected" && proxy.rejection).toEqual({
			code: "backend_error",
			message: "A proxy setting (HTTPS_PROXY, HTTP_PROXY or similar) is not a complete URL.",
		});
		const org = await rig.catalogue.modes("/p");
		expect(org.status === "rejected" && org.rejection.code).toBe("auth");
	});

	test("a CLI that never answers is closed after the probe timeout and reported", async () => {
		const hung = probeQuery(initAnswer());
		hung.initializationResult = () => new Promise(() => undefined);
		const rig = rigOf({ queries: [hung] });
		const pending = rig.catalogue.models("/p");
		await Bun.sleep(20);
		rig.clock.advance(PROBE_TIMEOUT_MS);
		const result = await pending;
		expect(result.status === "rejected" && result.rejection.message).toContain("did not answer in time");
		expect(hung.closed).toBe(true);
	});

	test("a missing binary answers every read as a rejection and starts nothing", async () => {
		const rig = rigOf({ cli: { found: false, reason: "no claude here" } });
		for (const result of [
			await rig.catalogue.models("/p"),
			await rig.catalogue.commands("/p"),
			await rig.catalogue.modes("/p"),
			await rig.catalogue.initialize("/p"),
		]) {
			expect(isRejected(result)).toBe(true);
		}
		expect(rig.sdk.started).toHaveLength(0);
	});

	test("an answer shaped unlike the SDK's types is a rejection, not a throw", async () => {
		const broken = Object.assign({}, initAnswer(), { commands: [{ name: "x", argumentHint: "" }] });
		const rig = rigOf({ queries: [probeQuery(broken)] });
		const listed = await rig.catalogue.commands("/p");
		expect(listed.status === "rejected" && listed.rejection.code).toBe("backend_error");
	});
});
