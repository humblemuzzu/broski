import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { MAX_NAME_CHARS } from "../../contract";
import { createWorld, modelsJson, type World, writeAgentFile } from "./catalogue_support";

let world: World;

beforeEach(async () => {
	world = await createWorld();
});

afterEach(() => {
	mock.restore();
	world.env.dispose();
});

const ids = (models: readonly { provider: string; id: string }[]) =>
	models.map((model) => `${model.provider}/${model.id}`);

describe("ModelRuntimeHost.available", () => {
	test("concurrent callers share one refresh; a later one refreshes only once a file changed", async () => {
		const { runtime } = world.services.models;
		const refresh = spyOn(runtime, "refresh");
		const results = await Promise.all([1, 2, 3].map(() => world.services.models.available()));
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith({ allowNetwork: false });
		expect(new Set(results.map((result) => result.models)).size).toBe(1);

		await world.services.models.available();
		expect(refresh).toHaveBeenCalledTimes(1);
		writeAgentFile(world.env, "auth.json", "{}");
		await world.services.models.available();
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	test("reads models.json again whenever it changed", async () => {
		const host = world.services.models;
		expect((await host.available()).models).toEqual([]);
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		expect(ids((await host.available()).models)).toEqual(["local/one"]);
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }, { id: "two" }]));
		expect(ids((await host.available()).models)).toEqual(["local/one", "local/two"]);
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "two" }]));
		expect(ids((await host.available()).models)).toEqual(["local/two"]);
	});

	test("a models.json caught half-written is not loaded: the runtime the sessions use keeps its models", async () => {
		const host = world.services.models;
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		expect((await host.available()).error).toBeUndefined();

		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]).slice(0, 40));
		const broken = await host.available();
		expect(broken.error).toContain("is not valid JSON");
		expect(ids(broken.models)).toEqual(["local/one"]);
		expect(host.runtime.getModel("local", "one")).toBeDefined();

		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }, { id: "two" }]));
		const fixed = await host.available();
		expect(fixed.error).toBeUndefined();
		expect(ids(fixed.models)).toEqual(["local/one", "local/two"]);
	});

	test("comments and trailing commas are JSON as Pi reads it, so such a file is loaded", async () => {
		const host = world.services.models;
		const text = modelsJson([{ id: "one" }])
			.replace("{", "{ // mine\n")
			.replace(/\}$/, ",}");
		writeAgentFile(world.env, "models.json", text);
		const result = await host.available();
		expect(result.error).toBeUndefined();
		expect(ids(result.models)).toEqual(["local/one"]);
	});

	test("a file that parses but breaks Pi's schema is loaded as the terminal loads it, with its error", async () => {
		const host = world.services.models;
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		await host.available();

		writeAgentFile(world.env, "models.json", JSON.stringify({ providers: { local: { models: "nope" } } }));
		const result = await host.available();

		expect(result.error).toContain("models.json");
		expect(result.models).toEqual([]);
		expect(host.runtime.getModel("local", "one")).toBeUndefined();
	});

	test("a refresh that throws is reported, and the next call refreshes again", async () => {
		const host = world.services.models;
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		await host.available();
		writeAgentFile(world.env, "auth.json", "{}");
		const refresh = spyOn(host.runtime, "refresh").mockRejectedValueOnce(new Error("disk went away"));

		expect((await host.available()).error).toBe("disk went away");
		const next = await host.available();
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(next.error).toBeUndefined();
		expect(ids(next.models)).toEqual(["local/one"]);
	});

	test("a refresh that throws without a message still gives a reason", async () => {
		const host = world.services.models;
		spyOn(host.runtime, "refresh").mockRejectedValueOnce(new Error(""));
		expect((await host.available()).error).toBe("Error");
	});

	test("a provider's own refresh error is reported without discarding the new list", async () => {
		const host = world.services.models;
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }]));
		await host.available();
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "two" }]));
		const refresh = host.runtime.refresh.bind(host.runtime);
		spyOn(host.runtime, "refresh").mockImplementationOnce(async (options) => ({
			...(await refresh(options)),
			errors: new Map([["local", new Error("store")]]),
		}));

		const result = await host.available();
		expect(result.error).toBe("local: store");
		expect(ids(result.models)).toEqual(["local/two"]);
	});
});

describe("ModelRuntimeHost.scope", () => {
	test("one enabledModels resolution per refresh: each reads the availability again", async () => {
		const host = world.services.models;
		writeAgentFile(world.env, "models.json", modelsJson([{ id: "one" }, { id: "two" }]));
		await host.available();
		const available = spyOn(host.runtime, "getAvailable");

		const first = await host.scope(["local/two"]);
		const again = await host.scope(["local/two"]);
		expect(available).toHaveBeenCalledTimes(1);
		expect(again).toBe(first);
		expect(first.scopedModels.map((scoped) => scoped.model.id)).toEqual(["two"]);

		writeAgentFile(world.env, "models.json", modelsJson([{ id: "two" }]));
		await host.available();
		await host.scope(["local/two"]);
		expect(available).toHaveBeenCalledTimes(2);
	});
});

describe("ModelRuntimeHost.refreshFromNetwork", () => {
	test("names each provider that failed on one bounded line, and counts those past a screenful", async () => {
		const host = world.services.models;
		const errors = new Map(
			Array.from({ length: 40 }, (_, n) => [
				`p${n}`,
				new Error(n === 0 ? `\u001b[31m${"x".repeat(2_000_000)}` : "down"),
			]),
		);
		await host.available();
		spyOn(host.runtime, "refresh").mockResolvedValueOnce({ aborted: false, errors });
		const problems = await host.refreshFromNetwork();
		expect(problems).toHaveLength(33);
		expect(problems[0]?.startsWith("p0: xxx")).toBe(true);
		for (const line of problems) expect(line.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
		expect(problems[1]).toBe("p1: down");
		expect(problems.at(-1)).toBe("and 8 more");
	});
});
