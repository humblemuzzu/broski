import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { join } from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { piStatus } from "../../backends/pi/status";
import { BackendStatus, MAX_TEXT_CHARS } from "../../contract";
import {
	createWorld,
	modelsJson,
	registerFauxProviders,
	type World,
	writeAgentFile,
	writeSettings,
} from "./catalogue_support";

let world: World;

beforeEach(async () => {
	world = await createWorld();
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

async function status() {
	const result = await piStatus(world.services.models, world.env.agentDir);
	expect(BackendStatus.safeParse(result).success).toBe(true);
	return result;
}

const signIn = () =>
	registerFauxProviders(world.services.models.runtime, [{ provider: "faux", models: [{ id: "a" }, { id: "b" }] }]);

describe("piStatus", () => {
	test("with no credentials Pi is signed out and not usable, and says what to do", async () => {
		const result = await status();
		expect(result).toMatchObject({ installed: true, version: VERSION, auth: "signed_out", usable: false });
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]).toMatchObject({ severity: "error" });
		expect(result.issues[0]?.message).toContain("/login");
	});

	test("with a model available it is signed in and usable, with nothing to report", async () => {
		await signIn();
		expect(await status()).toEqual({ installed: true, version: VERSION, auth: "signed_in", usable: true, issues: [] });
	});

	test("an agent directory that does not exist is a warning", async () => {
		await signIn();
		const missing = join(world.env.root, "nowhere");
		const result = await piStatus(world.services.models, missing);
		expect(result.usable).toBe(true);
		expect(result.issues).toEqual([{ severity: "warning", message: expect.stringContaining(missing) }]);
	});

	test("a default model that is not available is a warning, an available one is not", async () => {
		await signIn();
		writeSettings(world.env, { defaultProvider: "faux", defaultModel: "b" });
		expect((await status()).issues).toEqual([]);
		writeSettings(world.env, { defaultProvider: "faux", defaultModel: "gone" });
		expect((await status()).issues).toEqual([{ severity: "warning", message: expect.stringContaining("faux/gone") }]);
	});

	test("an unreadable models.json is an error while nothing else is usable", async () => {
		writeAgentFile(world.env, "models.json", "{ not json");
		const result = await status();
		expect(result.usable).toBe(false);
		expect(result.issues.map((issue) => issue.severity)).toEqual(["error", "error"]);
		expect(result.issues[0]?.message).toContain("models.json is not valid JSON");
	});

	test("an unreadable models.json is only a warning while another provider still works", async () => {
		await signIn();
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		expect(await status()).toMatchObject({ auth: "signed_in", usable: true, issues: [] });
		writeAgentFile(world.env, "models.json", "{ not json");
		const result = await status();
		expect(result).toMatchObject({ auth: "signed_in", usable: true });
		expect(result.issues).toEqual([{ severity: "warning", message: expect.stringContaining("is not valid JSON") }]);
	});

	test("models a half-written models.json defined stay usable while it does not parse, with a warning", async () => {
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		expect(await status()).toMatchObject({ auth: "signed_in", usable: true });
		writeAgentFile(world.env, "models.json", "{ not json");
		const result = await status();
		expect((await world.services.models.available()).models).toHaveLength(1);
		expect(result).toMatchObject({ auth: "signed_in", usable: true });
		expect(result.issues.map((issue) => issue.severity)).toEqual(["warning"]);
	});

	test("signed in with no model to run says so", async () => {
		await signIn();
		spyOn(world.services.models.runtime, "getAvailableSnapshot").mockReturnValue([]);
		const result = await status();
		expect(result).toMatchObject({ auth: "signed_in", usable: false });
		expect(result.issues).toEqual([{ severity: "error", message: expect.stringContaining("No model is available") }]);
	});

	test("never fails: what cannot be found out is an unknown, unusable error", async () => {
		spyOn(world.services.models.runtime, "getProviders").mockImplementation(() => {
			throw new Error("provider table is gone");
		});
		expect(await status()).toEqual({
			installed: true,
			version: VERSION,
			auth: "unknown",
			usable: false,
			issues: [{ severity: "error", message: "Pi's state could not be read: provider table is gone" }],
		});
	});

	test("bounds a very long Pi message to what the contract allows", async () => {
		await signIn();
		spyOn(world.services.models.runtime, "getError").mockReturnValue("e".repeat(2 * MAX_TEXT_CHARS));
		const result = await status();
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.message).toHaveLength(MAX_TEXT_CHARS);
	});
});

describe("Pi's httpProxy setting", () => {
	test("is said not to be used while the bridge's own environment names no proxy, and not once it does", async () => {
		await signIn();
		writeSettings(world.env, { httpProxy: "http://proxy.example:3128" });
		const unset = await status();
		expect(unset.issues).toEqual([{ severity: "warning", message: expect.stringContaining("httpProxy") }]);
		expect(process.env.HTTPS_PROXY).toBeUndefined();

		process.env.HTTPS_PROXY = "http://proxy.example:3128";
		process.env.HTTP_PROXY = "http://proxy.example:3128";
		expect((await status()).issues).toEqual([]);
	});
});
