/**
 * The model picker's whole catalogue: every model Pi knows, the ones nothing can run here marked with what is
 * missing. All on a throwaway agent dir with no credential.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_CATALOG_ITEMS, type ModelSummary, ModelsListResult } from "../../contract";
import { encodeFrame } from "../../core/frame";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function listed(rig: LiveRig, includeUnavailable: boolean): Promise<ModelSummary[]> {
	const result = await rig.backend.listModels(rig.cwd, { includeUnavailable });
	expect(ModelsListResult.safeParse(result).success).toBe(true);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.models;
}

const deepseekModel = "deepseek/deepseek-flash";

const usable = (models: readonly ModelSummary[]) => models.filter((model) => model.unavailableReason === undefined);

function modelOf(models: readonly ModelSummary[], id: string): ModelSummary {
	const found = models.find((model) => model.id === id);
	if (found === undefined) throw new Error(`${id} is not listed`);
	return found;
}

describe("the catalogue with the models nothing can run", () => {
	test("lists only what can run by default, as before", async () => {
		t = await LiveRig.create();
		const models = await listed(t, false);
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.unavailableReason === undefined)).toBe(true);
		expect(await listed(t, false)).toEqual(models);
	});

	test("adds every other model Pi knows after the usable ones, each with the reason it cannot run", async () => {
		t = await LiveRig.create();
		const available = await listed(t, false);
		const all = await listed(t, true);
		expect(all.slice(0, available.length)).toEqual(available);
		const unavailable = all.slice(available.length);
		expect(unavailable.length).toBeGreaterThan(500);
		expect(all.length).toBeLessThanOrEqual(MAX_CATALOG_ITEMS);
		expect(new Set(all.map((model) => model.id)).size).toBe(all.length);
		for (const model of unavailable) expect(model.unavailableReason).toStartWith("Not signed in to ");
	});

	test("names the variable a provider reads its key from, and the way to sign in", async () => {
		t = await LiveRig.create();
		const all = await listed(t, true);
		const openai = all.find((model) => model.providerId === "openai" && model.unavailableReason !== undefined);
		expect(openai?.unavailableReason).toBe(
			"Not signed in to OpenAI: sign in with /login in pi. Pi reads OPENAI_API_KEY from the bridge's environment.",
		);
		const anthropic = all.find((model) => model.providerId === "anthropic");
		expect(anthropic?.unavailableReason).toContain("ANTHROPIC_API_KEY");
		const oauthOnly = all.find((model) => model.providerId === "openai-codex");
		expect(oauthOnly?.unavailableReason).toBe("Not signed in to OpenAI Codex (legacy): sign in with /login in pi.");
	});

	test("a provider with a stored credential has its models usable and without a reason", async () => {
		t = await LiveRig.create();
		const before = await listed(t, true);
		expect(modelOf(before, deepseekModel).unavailableReason).toBeDefined();
		writeFileSync(
			join(t.world.env.agentDir, "auth.json"),
			JSON.stringify({ deepseek: { type: "api_key", key: "sk-not-real" } }),
		);
		const after = await listed(t, true);
		const deepseek = after.filter((model) => model.providerId === "deepseek");
		expect(deepseek.length).toBeGreaterThan(0);
		expect(deepseek.every((model) => model.unavailableReason === undefined)).toBe(true);
		expect(usable(after).length).toBeGreaterThan(usable(before).length);
	});

	test("fits the smallest frame the link carries", async () => {
		t = await LiveRig.create();
		const models = await listed(t, true);
		const bytes = encodeFrame({
			type: "models.list.result",
			requestId: "r",
			result: { status: "accepted", models },
		}).bytes;
		expect(bytes).toBeLessThan(1_048_576);
	});
});

describe("a model that cannot run", () => {
	test("is refused as `auth` with what is missing, when a session is asked to switch to it", async () => {
		t = await LiveRig.create();
		const all = await listed(t, true);
		const gone =
			all.find((model) => model.id === "openai/gpt-4o") ?? all.find((model) => model.unavailableReason !== undefined);
		if (gone === undefined) throw new Error("no unavailable model");
		const live = await t.rig.openNew();
		const refused = await live.control.setModel(gone.id);
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "auth", message: gone.unavailableReason } });
		const snapshot = live.session.snapshot();
		expect(snapshot.modelId).not.toBe(gone.id);
	});

	test("is refused as `auth` when a new session asks to start on it, and an unknown model is not found", async () => {
		t = await LiveRig.create();
		const all = await listed(t, true);
		const gone = all.find((model) => model.unavailableReason !== undefined);
		if (gone === undefined) throw new Error("no unavailable model");
		const started = await t.backend.open(
			{ kind: "new", options: { cwd: t.cwd, modelId: gone.id } },
			{ emit: () => {} },
		);
		expect(started).toMatchObject({ status: "rejected", rejection: { code: "auth", message: gone.unavailableReason } });
		const unknown = await t.backend.open(
			{ kind: "new", options: { cwd: t.cwd, modelId: "nobody/nothing" } },
			{ emit: () => {} },
		);
		expect(unknown).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});

	test("a usable model is still chosen", async () => {
		t = await LiveRig.create();
		const first = usable(await listed(t, true))[0];
		if (first === undefined) throw new Error("no usable model");
		const live = await t.rig.openNew();
		expect((await live.control.setModel(first.id)).status).toBe("accepted");
	});
});
