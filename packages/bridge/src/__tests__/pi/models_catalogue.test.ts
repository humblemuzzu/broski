import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { ModelCatalogue } from "../../backends/pi/models/catalogue";
import { type ModelSummary, ModelsListed, ModelsListResult } from "../../contract";
import {
	createWorld,
	modelsJson,
	registerFauxProviders,
	trustProject,
	type World,
	writeAgentFile,
	writeFile,
	writeSettings,
} from "./catalogue_support";

let world: World;
let catalogue: ModelCatalogue;

beforeEach(async () => {
	world = await createWorld();
	catalogue = new ModelCatalogue(world.services.models, world.env.agentDir);
});

async function registerModels(): Promise<void> {
	await registerFauxProviders(world.services.models.runtime, [
		{
			provider: "faux",
			withoutOff: ["no-off"],
			models: [
				{ id: "thinker", name: "Thinker", reasoning: true, contextWindow: 200_000 },
				{ id: "plain", name: "Plain", reasoning: false, input: ["text"] },
				{ id: "no-off", name: "No off", reasoning: true },
			],
		},
		{
			provider: "router",
			models: [{ id: "anthropic/claude-x", name: "Claude X", reasoning: true }],
		},
	]);
}

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

async function list(cwd?: string): Promise<ModelSummary[]> {
	const listed = await catalogue.list(cwd);
	expect(ModelsListResult.safeParse(listed).success).toBe(true);
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	expect(ModelsListed.safeParse(listed).success).toBe(true);
	expect(new Set(listed.models.map((model) => model.id)).size).toBe(listed.models.length);
	expect(listed.models.filter((model) => model.isDefault).length).toBeLessThanOrEqual(1);
	for (const { thinking } of listed.models) {
		const values = thinking.options.map((option) => option.value);
		expect(new Set(values).size).toBe(values.length);
		if (thinking.defaultValue !== undefined) expect(values).toContain(thinking.defaultValue);
	}
	return listed.models;
}

const byId = (models: readonly ModelSummary[]) => new Map(models.map((model) => [model.id, model]));

describe("ModelCatalogue.list", () => {
	beforeEach(registerModels);

	test("lists every available model under its wire id, with what Pi knows about it", async () => {
		const models = await list();
		expect(models.map((model) => model.id)).toEqual([
			"faux/thinker",
			"faux/plain",
			"faux/no-off",
			"router/anthropic/claude-x",
		]);
		const thinker = byId(models).get("faux/thinker");
		expect(thinker).toMatchObject({
			displayName: "Thinker",
			providerId: "faux",
			providerName: "faux",
			contextWindow: 200_000,
			inputModalities: ["text", "image"],
			isDefault: false,
		});
		expect(byId(models).get("faux/plain")?.inputModalities).toEqual(["text"]);
	});

	test("gives each model the thinking levels Pi supports for it", async () => {
		const models = byId(await list());
		const levels = (id: string) => models.get(id)?.thinking.options.map((option) => option.value);
		expect(levels("faux/thinker")).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(levels("faux/no-off")).toEqual(["minimal", "low", "medium", "high"]);
		expect(levels("faux/plain")).toEqual([]);
		expect(models.get("faux/thinker")?.thinking.defaultValue).toBe("medium");
		expect(models.get("faux/plain")?.thinking.defaultValue).toBeUndefined();
	});

	test("applies the user's thinking defaults, clamped to each model", async () => {
		writeSettings(world.env, { defaultThinkingLevel: "off", modelThinkingLevels: { "faux/no-off": "high" } });
		const models = byId(await list());
		expect(models.get("faux/thinker")?.thinking.defaultValue).toBe("off");
		expect(models.get("faux/no-off")?.thinking.defaultValue).toBe("high");

		writeSettings(world.env, { defaultThinkingLevel: "off" });
		expect(byId(await list()).get("faux/no-off")?.thinking.defaultValue).toBe("minimal");
	});

	test("a model id with a slash keeps its provider and round-trips through the table", async () => {
		const models = await list();
		expect(models.find((model) => model.id.endsWith("claude-x"))).toMatchObject({
			id: "router/anthropic/claude-x",
			providerId: "router",
			displayName: "Claude X",
		});
		const found = await catalogue.find("router/anthropic/claude-x");
		expect(found).toMatchObject({ provider: "router", id: "anthropic/claude-x" });
		expect(await catalogue.find("router/anthropic")).toBeUndefined();
		expect(await catalogue.find("anthropic/claude-x")).toBeUndefined();
	});

	test("a provider id with a slash is not mistaken for a provider and an id", async () => {
		await registerFauxProviders(world.services.models.runtime, [{ provider: "corp/gateway", models: [{ id: "m" }] }]);
		expect((await list()).map((model) => model.id)).toContain("corp%2Fgateway/m");
		expect(await catalogue.find("corp%2Fgateway/m")).toMatchObject({ provider: "corp/gateway", id: "m" });
		expect(await catalogue.find("corp/gateway/m")).toBeUndefined();
		expect(await catalogue.find("corp/gateway")).toBeUndefined();
	});

	test("a + b/c and a/b + c are two models with two ids, each found as itself", async () => {
		await registerFauxProviders(world.services.models.runtime, [
			{ provider: "a", models: [{ id: "b/c" }] },
			{ provider: "a/b", models: [{ id: "c" }] },
			{ provider: "50%", models: [{ id: "x" }] },
		]);
		const ids = (await list()).map((model) => model.id);
		expect(ids).toEqual(expect.arrayContaining(["a/b/c", "a%2Fb/c", "50%25/x"]));
		expect(await catalogue.find("a/b/c")).toMatchObject({ provider: "a", id: "b/c" });
		expect(await catalogue.find("a%2Fb/c")).toMatchObject({ provider: "a/b", id: "c" });
		expect(await catalogue.find("50%25/x")).toMatchObject({ provider: "50%", id: "x" });
	});

	test("does not list a model whose wire id cannot be an id", async () => {
		await registerFauxProviders(world.services.models.runtime, [
			{ provider: "long", models: [{ id: "fits" }, { id: "x".repeat(300) }] },
		]);
		const ids = (await list()).filter((model) => model.providerId === "long").map((model) => model.id);
		expect(ids).toEqual(["long/fits"]);
	});

	test("two providers sharing a bare id are two models", async () => {
		await registerFauxProviders(world.services.models.runtime, [
			{ provider: "alpha", models: [{ id: "shared", name: "Shared" }] },
			{ provider: "beta", models: [{ id: "shared", name: "Shared" }] },
		]);
		const models = (await list()).filter((model) => model.id.endsWith("/shared"));
		expect(models.map((model) => model.id)).toEqual(["alpha/shared", "beta/shared"]);
		expect(models.map((model) => model.providerId)).toEqual(["alpha", "beta"]);
		expect(await catalogue.find("alpha/shared")).toMatchObject({ provider: "alpha", id: "shared" });
		expect(await catalogue.find("beta/shared")).toMatchObject({ provider: "beta", id: "shared" });
	});

	test("marks the model the settings name as the default, and nothing when it is not available", async () => {
		writeSettings(world.env, { defaultProvider: "router", defaultModel: "anthropic/claude-x" });
		expect((await list()).filter((model) => model.isDefault).map((model) => model.id)).toEqual([
			"router/anthropic/claude-x",
		]);
		writeSettings(world.env, { defaultProvider: "faux", defaultModel: "gone" });
		expect((await list()).some((model) => model.isDefault)).toBe(false);
		writeSettings(world.env, { defaultModel: "plain" });
		expect((await list()).some((model) => model.isDefault)).toBe(false);
	});

	test("puts the user's enabledModels first, in their order, and keeps the rest", async () => {
		writeSettings(world.env, { enabledModels: ["router/anthropic/claude-x", "faux/plain", "nothing-like-this"] });
		expect((await list()).map((model) => model.id)).toEqual([
			"router/anthropic/claude-x",
			"faux/plain",
			"faux/thinker",
			"faux/no-off",
		]);
	});

	test("an enabledModels list Pi cannot resolve does not hide the models", async () => {
		writeSettings(world.env, { enabledModels: [7, null] });
		expect(await list()).toHaveLength(4);
	});

	test("reads the project's settings only for a trusted project", async () => {
		const { cwd } = world.env;
		writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "plain" }));
		expect((await list(cwd)).some((model) => model.isDefault)).toBe(false);
		expect((await list()).some((model) => model.isDefault)).toBe(false);
		trustProject(world.env, cwd);
		expect((await list(cwd)).filter((model) => model.isDefault).map((model) => model.id)).toEqual(["faux/plain"]);
		expect((await list()).some((model) => model.isDefault)).toBe(false);
	});

	test("bounds every name", async () => {
		await registerFauxProviders(world.services.models.runtime, [
			{
				provider: "styled",
				models: [
					{ id: "s", name: "\u001b[31mRed\u001b[0m" },
					{ id: "blank", name: "  " },
				],
			},
		]);
		const models = byId(await list());
		expect(models.get("styled/s")?.displayName).toBe("Red");
		expect(models.get("styled/blank")?.displayName).toBe("blank");
	});
});

describe("ModelCatalogue.list when Pi cannot load its models", () => {
	test("is rejected as a backend error that says why, when nothing can be listed", async () => {
		writeAgentFile(world.env, "models.json", "{ not json");
		const listed = await catalogue.list(undefined);
		expect(listed).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(listed.status === "rejected" && listed.rejection.message).toContain("models.json is not valid JSON");
	});

	test("is an empty list, not an error, when nothing is signed in", async () => {
		expect(await catalogue.list(undefined)).toEqual({ status: "accepted", models: [] });
	});
});

describe("ModelCatalogue.find", () => {
	beforeEach(registerModels);

	test("finds a model nobody listed yet, and refuses what Pi does not have", async () => {
		expect(await catalogue.find("faux/thinker")).toMatchObject({ provider: "faux", id: "thinker" });
		expect(await catalogue.find("faux/missing")).toBeUndefined();
		expect(await catalogue.find("faux")).toBeUndefined();
		expect(await catalogue.find("")).toBeUndefined();
	});

	test("forgets a model that was listed and then removed from models.json", async () => {
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "a" }, { id: "b" }]));
		expect((await catalogue.list(undefined)).status).toBe("accepted");
		expect(await catalogue.find("local/b")).toMatchObject({ id: "b" });
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "a" }]));
		expect(await catalogue.find("local/b")).toBeUndefined();
		expect(await catalogue.find("local/a")).toMatchObject({ id: "a" });
	});
});
