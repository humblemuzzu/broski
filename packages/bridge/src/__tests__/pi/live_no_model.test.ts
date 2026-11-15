/**
 * A `pi` nobody has signed in to a provider has no model, and says so by holding a placeholder whose id, provider and
 * api are all "unknown" (pi-agent-core 1.5.2 `dist/agent.js:18-29`). The real `pi` runs here in an agent dir with no
 * models: the session must show no model, and refuse what needs one as `no_model`, not run a model called
 * "unknown/unknown".
 */

import { afterEach, describe, expect, test } from "bun:test";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const noModel = { status: "rejected", rejection: { code: "no_model" } };

describe("a session in an agent dir with no model", () => {
	test("shows no model and refuses thinking, compaction and a prompt as no_model", async () => {
		t = await LiveRig.create({ noModels: true });
		const live = await t.rig.openNew();

		expect(live.initial.modelId).toBeUndefined();
		expect(live.events().filter((event) => event.type === "model_changed")).toEqual([]);
		expect(await live.control.setThinking("high")).toMatchObject(noModel);
		expect(await live.control.compact?.(undefined)).toMatchObject(noModel);
		expect(await live.prompt("hello")).toMatchObject(noModel);
		expect(live.reduced().run).toBeUndefined();
		live.assertSettled();
	});

	test("a catalog read there lists no model and offers no model to start a new session on", async () => {
		t = await LiveRig.create({ noModels: true });
		expect(await t.backend.listModels(t.cwd, {})).toMatchObject({ models: [] });
		expect(await t.world.parts.models.starting(t.cwd)).toBeUndefined();
	});
});
