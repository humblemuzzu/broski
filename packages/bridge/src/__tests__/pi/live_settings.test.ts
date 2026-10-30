/**
 * On the real adapter: a model switched mid-run, Pi's global default left alone, and
 * thinking on a model that has no `off`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelSummary } from "../../contract";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { LiveRig } from "./helpers/live-rig";
import { sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function modelNamed(rig: LiveRig, id: string): Promise<ModelSummary> {
	const listed = await rig.backend.listModels(rig.cwd);
	if (listed.status === "rejected") throw new Error(listed.rejection.message);
	const found = listed.models.find((model) => model.id === wireIdOf(id));
	if (!found) throw new Error(`model ${id} is not listed`);
	return found;
}

const values = (model: ModelSummary) => model.thinking.options.map((option) => option.value);

describe("a model switched mid-run", () => {
	test("is shown at once, reaches the next request, is written to the session, and never becomes Pi's default (a model other than the default)", async () => {
		t = await LiveRig.create();
		const settings = join(t.world.env.agentDir, "settings.json");
		const before = readFileSync(settings, "utf8");
		const reasoner = await modelNamed(t, FAUX_MODEL_IDS.reasoner);
		const live = await t.rig.openNew({ modelId: reasoner.id });
		await t.rig.arrange(live.ref, { kind: "echo_model" });
		await live.prompt("Which model?");
		const first = await live.waitFor("block_finished");
		expect(first.text).toBe(reasoner.id);

		const mark = live.recorder.items.length;
		const noOff = await modelNamed(t, FAUX_MODEL_IDS.noOff);
		expect((await live.control.setModel(noOff.id)).status).toBe("accepted");
		const changed = await live.waitFor("model_changed", (event) => event.modelId === noOff.id, mark);
		expect(values(noOff)).toContain(changed.thinking ?? "");
		expect(live.reduced().run).toBeDefined();

		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished");
		const echoed = live.events().flatMap((event) => (event.type === "block_finished" ? [event.text] : []));
		expect(echoed).toEqual([reasoner.id, noOff.id]);
		expect(
			sessionEntries(t.fileOf(live.ref)).some(
				(entry) => entry.type === "model_change" && entry.modelId === FAUX_MODEL_IDS.noOff,
			),
		).toBe(true);
		await t.backend.dispose();
		expect(readFileSync(settings, "utf8")).toBe(before);
	});

	test("a thinking level chosen on the session is also left out of Pi's settings", async () => {
		t = await LiveRig.create();
		const settings = join(t.world.env.agentDir, "settings.json");
		const before = readFileSync(settings, "utf8");
		const reasoner = await modelNamed(t, FAUX_MODEL_IDS.reasoner);
		const live = await t.rig.openNew({ modelId: reasoner.id });
		const level = values(reasoner).find((value) => value !== live.initial.thinking);
		if (level === undefined) throw new Error("the reasoner offers one thinking value");
		expect((await live.control.setThinking(level)).status).toBe("accepted");
		expect((await live.waitFor("model_changed", (event) => event.thinking === level)).modelId).toBe(reasoner.id);
		await t.backend.dispose();
		expect(readFileSync(settings, "utf8")).toBe(before);
	});
});

describe("thinking on a model without off", () => {
	test("its levels leave out off, off is refused, and switching models keeps the level valid", async () => {
		t = await LiveRig.create();
		const noOff = await modelNamed(t, FAUX_MODEL_IDS.noOff);
		expect(values(noOff)).not.toContain("off");
		expect(values(noOff).length).toBeGreaterThan(0);

		const live = await t.rig.openNew({ modelId: noOff.id });
		expect(values(noOff)).toContain(live.initial.thinking ?? "");
		const refused = await live.control.setThinking("off");
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		for (const value of values(noOff)) {
			const mark = live.recorder.items.length;
			expect((await live.control.setThinking(value)).status).toBe("accepted");
			await live.waitFor("model_changed", (event) => event.thinking === value, mark);
		}

		const plain = wireIdOf(FAUX_MODEL_IDS.plain);
		expect((await live.control.setModel(plain)).status).toBe("accepted");
		const toPlain = await live.waitFor("model_changed", (event) => event.modelId === plain);
		expect(toPlain).not.toHaveProperty("thinking");
		expect(live.reduced().thinking).toBeUndefined();
		const mark = live.recorder.items.length;
		expect((await live.control.setModel(noOff.id)).status).toBe("accepted");
		const back = await live.waitFor("model_changed", (event) => event.modelId === noOff.id, mark);
		expect(values(noOff)).toContain(back.thinking ?? "");
		expect(back.thinking).not.toBe("off");
		live.assertValid();
	});

	test("a session opened with a thinking value the model lacks is refused", async () => {
		t = await LiveRig.create();
		const noOff = await modelNamed(t, FAUX_MODEL_IDS.noOff);
		const opened = await t.backend.open(
			{ kind: "new", options: { cwd: t.cwd, modelId: noOff.id, thinking: "off" } },
			{ emit: () => {} },
		);
		expect(opened).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		const unknown = await t.backend.open(
			{ kind: "new", options: { cwd: t.cwd, modelId: "faux/no-such-model" } },
			{ emit: () => {} },
		);
		expect(unknown).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});
});

describe("the model a new session starts on, with the user's enabledModels", () => {
	test("is the scope's first when the saved default is outside it, at the level its pattern names", async () => {
		t = await LiveRig.create({ settings: { enabledModels: [`${wireIdOf(FAUX_MODEL_IDS.noOff)}:low`] } });
		const live = await t.rig.openNew();
		expect(live.initial).toMatchObject({ modelId: wireIdOf(FAUX_MODEL_IDS.noOff), thinking: "low" });
	});

	test("is the saved default when the scope holds it", async () => {
		const scope = [wireIdOf(FAUX_MODEL_IDS.plain), wireIdOf(FAUX_MODEL_IDS.reasoner)];
		t = await LiveRig.create({ settings: { enabledModels: scope } });
		const live = await t.rig.openNew();
		expect(live.initial.modelId).toBe(wireIdOf(FAUX_MODEL_IDS.reasoner));
	});

	test("is the one the phone named, scope or not", async () => {
		t = await LiveRig.create({ settings: { enabledModels: [wireIdOf(FAUX_MODEL_IDS.plain)] } });
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.tiny) });
		expect(live.initial.modelId).toBe(wireIdOf(FAUX_MODEL_IDS.tiny));
	});
});
