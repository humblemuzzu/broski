import { backendCapabilities } from "../backend";
import { Capabilities } from "../capabilities";
import type { ModelSummary } from "../models";
import { CommandsListed, ModelsListed, ModesListed } from "../read-results";
import { BackendStatus } from "../status";
import { expect, fail, type Rig } from "./conformance-harness";

export async function capabilitiesMatchTheBackend(rig: Rig): Promise<void> {
	const { backend } = rig;
	const capabilities = Capabilities.safeParse(backendCapabilities(backend));
	expect(capabilities.success, `the capabilities are not valid: ${capabilities.error?.message}`);
	const hasCall = backend.call !== undefined;
	expect(hasCall === backend.traits.backendOps.length > 0, "backendOps must be declared exactly when call() exists");
	const status = BackendStatus.safeParse(await backend.status());
	expect(status.success, `status() is not a valid BackendStatus: ${status.error?.message}`);
}

export async function modelsAreConsistent(rig: Rig): Promise<void> {
	const listed = await rig.backend.listModels(rig.driver.cwd);
	if (listed.status === "rejected") fail(`listModels was rejected: ${listed.rejection.message}`);
	const parsed = ModelsListed.safeParse(listed);
	expect(parsed.success, `the model list is not valid: ${parsed.error?.message}`);
	const models = listed.models;
	expect(models.length > 0, "listModels() returned no models");
	expect(new Set(models.map((model) => model.id)).size === models.length, "model ids repeat");
	expect(models.filter((model) => model.isDefault).length <= 1, "more than one default model");
	for (const model of models) {
		const values = model.thinking.options.map((option) => option.value);
		const fallback = model.thinking.defaultValue;
		expect(new Set(values).size === values.length, `${model.id}: a thinking option repeats`);
		expect(fallback === undefined || values.includes(fallback), `${model.id}: the default thinking is not an option`);
		expect(rig.traits.thinking || values.length === 0, `${model.id}: thinking options without the thinking capability`);
	}
	await unavailableModelsFollowTheUsable(rig, models);
}

/** `includeUnavailable` lists the usable models as before, and after them only models that say why they cannot be used. */
async function unavailableModelsFollowTheUsable(rig: Rig, models: readonly ModelSummary[]): Promise<void> {
	expect(
		models.every((model) => model.unavailableReason === undefined),
		"a model with an unavailableReason is listed without includeUnavailable",
	);
	const all = await rig.backend.listModels(rig.driver.cwd, { includeUnavailable: true });
	if (all.status === "rejected") fail(`listModels with includeUnavailable was rejected: ${all.rejection.message}`);
	const parsed = ModelsListed.safeParse(all);
	expect(parsed.success, `the model list with includeUnavailable is not valid: ${parsed.error?.message}`);
	expect(
		models.every((model, at) => all.models[at]?.id === model.id),
		"includeUnavailable must list the usable models first, as the plain list does",
	);
	expect(
		all.models.slice(models.length).every((model) => model.unavailableReason !== undefined),
		"a model listed only with includeUnavailable must say why it is unavailable",
	);
}

export async function commandsAreListed(rig: Rig): Promise<void> {
	const listed = await rig.backend.listCommands({ cwd: rig.driver.cwd });
	if (listed.status === "rejected") fail(`listCommands was rejected: ${listed.rejection.message}`);
	const parsed = CommandsListed.safeParse(listed);
	expect(parsed.success, `the command list is not valid: ${parsed.error?.message}`);
	const ids = listed.commands.map((command) => command.id);
	expect(new Set(ids).size === ids.length, "command ids repeat");
	if (rig.traits.commands) expect(ids.length > 0, "commands are declared but none is listed");
	else expect(ids.length === 0, "commands are listed by a backend without commands");
}

export async function modesAreConsistent(rig: Rig): Promise<void> {
	const listed = await rig.backend.listModes(rig.driver.cwd);
	if (listed.status === "rejected") fail(`listModes was rejected: ${listed.rejection.message}`);
	const parsed = ModesListed.safeParse(listed);
	expect(parsed.success, `the mode list is not valid: ${parsed.error?.message}`);
	const axes = listed.modes;
	expect(new Set(axes.map((axis) => axis.id)).size === axes.length, "mode ids repeat");
	for (const axis of axes) {
		const values = axis.options.map((option) => option.value);
		expect(new Set(values).size === values.length, `${axis.id}: an option repeats`);
		expect(
			axis.defaultValue === undefined || values.includes(axis.defaultValue),
			`${axis.id}: the default is not an option`,
		);
	}
}
