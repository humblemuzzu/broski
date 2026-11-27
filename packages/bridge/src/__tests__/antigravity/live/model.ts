/**
 * The cheapest way to run a live prompt, chosen from what the user's `agy` lists rather than from an id that may not
 * exist in their version: the Gemini Flash family (not its Lite variant, should one be listed) at its lowest thinking
 * level, in agy's `default` mode, where it asks before it runs a command or writes a file. That mode is chosen by its
 * name, not as the catalog's default: the user may have made another mode their default.
 */

import type { AgentBackend, ModelSummary } from "../../../contract";

export interface CheapChoice {
	readonly modelId: string;
	/** Absent when the model has no thinking levels. */
	readonly thinking?: string;
	readonly mode: { readonly axis: string; readonly value: string };
}

const ASKING_MODE = "default";

/** Thinking levels from least to most, as agy and the providers it fronts name them. */
const LEVELS = ["none", "off", "minimal", "lowest", "low", "medium", "high", "xhigh", "max"];

let chosen: Promise<CheapChoice> | undefined;

/** Chosen once per process from the first backend that asks. */
export function cheapChoice(backend: AgentBackend, cwd: string): Promise<CheapChoice> {
	chosen ??= choose(backend, cwd);
	return chosen;
}

async function choose(backend: AgentBackend, cwd: string): Promise<CheapChoice> {
	const models = await backend.listModels(cwd);
	if (models.status === "rejected") throw new Error(`agy listed no models: ${models.rejection.message}`);
	const flash = models.models.filter((model) => {
		const name = `${model.id} ${model.displayName}`;
		return /gemini/i.test(name) && /flash/i.test(name) && !/lite/i.test(name);
	});
	const [model] = flash;
	if (model === undefined) {
		const listed = models.models.map((candidate) => candidate.id).join(", ");
		throw new Error(`agy lists no Gemini Flash model to run the live tests on (it lists ${listed})`);
	}
	const modes = await backend.listModes(cwd);
	if (modes.status === "rejected") throw new Error(`agy listed no modes: ${modes.rejection.message}`);
	const axis = modes.modes.find((candidate) => candidate.options.some((option) => option.value === ASKING_MODE));
	if (axis === undefined) {
		const listed = modes.modes.flatMap((candidate) => candidate.options.map((option) => option.value)).join(", ");
		throw new Error(
			`agy lists no \`${ASKING_MODE}\` mode, where it asks before running a command (it lists ${listed})`,
		);
	}
	return { modelId: model.id, ...thinkingOf(model), mode: { axis: axis.id, value: ASKING_MODE } };
}

function thinkingOf(model: ModelSummary): { thinking?: string } {
	const values = model.thinking.options.map((option) => option.value);
	if (values.length === 0) return {};
	const ranked = values.filter((value) => LEVELS.includes(value.toLowerCase()));
	const [lowest] = ranked.sort((a, b) => LEVELS.indexOf(a.toLowerCase()) - LEVELS.indexOf(b.toLowerCase()));
	if (lowest === undefined) {
		throw new Error(`which thinking level of ${model.id} is the lowest is not known: ${values.join(", ")}`);
	}
	return { thinking: lowest };
}
