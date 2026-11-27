import type { ModelSummary } from "../models";
import { expect, fail, type LiveSession, type Rig } from "./conformance-harness";

async function models(rig: Rig): Promise<ModelSummary[]> {
	const listed = await rig.backend.listModels(rig.driver.cwd);
	if (listed.status === "rejected") fail(`listModels was rejected: ${listed.rejection.message}`);
	return listed.models;
}

/** Every listed model and thinking value can be chosen and shows as `model_changed`; anything else is refused. */
export async function modelAndThinkingCanBeSet(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	const control = live.control;
	for (const model of await models(rig)) {
		const chosen = live.recorder.items.length;
		expect((await control.setModel(model.id)).status === "accepted", `choosing ${model.id} was rejected`);
		await live.waitFor("model_changed", (event) => event.modelId === model.id, chosen);
		for (const option of model.thinking.options) {
			const mark = live.recorder.items.length;
			expect(
				(await control.setThinking(option.value)).status === "accepted",
				`${model.id}: ${option.value} was rejected`,
			);
			await live.waitFor("model_changed", (event) => event.thinking === option.value, mark);
		}
		const offTheList = await control.setThinking("not-a-thinking-value");
		expect(offTheList.status === "rejected", `${model.id}: a thinking value it does not offer was accepted`);
	}
	const unknown = await control.setModel("not-a-model");
	expect(unknown.status === "rejected" && unknown.rejection.code === "not_found", "an unknown model must be not_found");
	live.assertValid();
	await aModelChosenMidRunReachesTheNextRun(rig);
}

/**
 * A model chosen mid-run is accepted, is the session's model once the run has ended, and reaches the next run; whether
 * the run's own later requests take it is the backend's. Which model a request ran with shows only in the `echo_model`
 * scenario, which a real model cannot play (it does not know the backend's id for it): when the driver declines it, a
 * hold stands in for the mid-run, and which model each request ran with goes unchecked.
 */
async function aModelChosenMidRunReachesTheNextRun(rig: Rig): Promise<void> {
	const [first, second] = await models(rig);
	if (!first || !second) return;
	const live = await rig.openNew({ modelId: first.id });
	const echoes = await rig.driver.arrange(live.ref, { kind: "echo_model" });
	if (!echoes) await rig.arrange(live.ref, { kind: "hold" });
	expect((await live.prompt("Which model?")).status === "accepted", "the prompt was rejected");
	if (echoes) await expectEcho(live, first.id, "the first request", 0);
	else await live.waitFor("run_started");
	expect((await live.control.setModel(second.id)).status === "accepted", `choosing ${second.id} mid-run was rejected`);
	await rig.driver.release(live.ref);
	const finished = await live.waitFor("run_finished");
	expect(finished.outcome.kind === "completed", `the run ended ${finished.outcome.kind}`);
	if (echoes) {
		await rig.arrange(live.ref, { kind: "echo_model" });
		const mark = live.recorder.items.length;
		expect((await live.prompt("And now?")).status === "accepted", "the next prompt was rejected");
		await expectEcho(live, second.id, "the next run", mark);
		await rig.driver.release(live.ref);
		await live.waitFor("run_finished", () => true, mark);
	}
	const { modelId } = live.reduced();
	expect(modelId === second.id, `the session's model is ${modelId}, not ${second.id}`);
	live.assertSettled();
}

/** The first text block after record `after`, which an `echo_model` request answers with the id of its model. */
async function expectEcho(live: LiveSession, modelId: string, what: string, after: number): Promise<void> {
	const echoed = await live.waitFor("block_finished", () => true, after);
	expect(echoed.text === modelId, `${what} ran with ${echoed.text}, not ${modelId}`);
}

/** A new session starts in the modes asked for; every listed value can be chosen; anything else is refused. */
export async function modesCanBeSet(rig: Rig): Promise<void> {
	const listed = await rig.backend.listModes(rig.driver.cwd);
	if (listed.status === "rejected") fail(`listModes was rejected: ${listed.rejection.message}`);
	const axes = listed.modes;
	const requested = axes.flatMap((axis) =>
		axis.options.slice(-1).map((option) => ({ axis: axis.id, value: option.value })),
	);
	const live = await rig.openNew({ modes: requested });
	for (const axis of axes) {
		const settings = live.initial.modes.filter((mode) => mode.axis === axis.id);
		expect(settings.length === 1, `the snapshot holds ${settings.length} values for mode ${axis.id}`);
	}
	for (const setting of requested) {
		const shown = live.initial.modes.find((mode) => mode.axis === setting.axis)?.value;
		expect(shown === setting.value, `mode ${setting.axis} did not start at ${setting.value}`);
	}
	for (const axis of axes) {
		for (const option of axis.options) {
			const mark = live.recorder.items.length;
			expect(
				(await live.control.setMode(axis.id, option.value)).status === "accepted",
				`${axis.id}=${option.value} was rejected`,
			);
			await live.waitFor("mode_changed", (event) => event.axis === axis.id && event.value === option.value, mark);
		}
		const offTheList = await live.control.setMode(axis.id, "not-a-mode-value");
		expect(
			offTheList.status === "rejected" && offTheList.rejection.code === "invalid_input",
			`${axis.id}: a value it does not offer must be invalid_input`,
		);
	}
	const unknown = await live.control.setMode("not-a-mode", "x");
	expect(
		unknown.status === "rejected" && unknown.rejection.code === "invalid_input",
		"an unknown mode must be invalid_input",
	);
	live.assertValid();
}

/** A session that can compact does, between runs, as one compaction. */
export async function compactionRuns(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	const control = live.control;
	if (!control.compact) return;
	await rig.arrange(live.ref, { kind: "reply" });
	await live.run("Leave something to compact.");
	const mark = live.recorder.items.length;
	expect((await control.compact(undefined)).status === "accepted", "compact was rejected");
	await live.waitFor("compaction_started", () => true, mark);
	await live.waitFor("compaction_finished", () => true, mark);
	await rig.driver.quiesce();
	live.assertSettled();
}
