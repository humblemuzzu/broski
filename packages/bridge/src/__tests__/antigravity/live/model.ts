/**
 * The cheapest way to run a live prompt, chosen from what the user's `agy` lists rather than from an id that may not
 * exist in their version: the Gemini Flash family (not its Lite variant, should one be listed) at its lowest thinking
 * level, in agy's `default` mode, where agy's own permission policy decides what it asks before it runs a command or
 * writes a file. That mode is chosen by its name, not as the catalog's default: the user may have made another mode
 * their default. Flash streams no thinking at its lowest level, so a turn that must show thinking runs at its highest.
 */

import type { AgentBackend, ModelSummary } from "../../../contract";

export interface CheapChoice {
	readonly modelId: string;
	/** The model's lowest thinking level; absent, as is `deepThinking`, when the model has no thinking levels. */
	readonly thinking?: string;
	/** The model's highest thinking level, for the one turn a test asks to think deeply (`guard.ts`). */
	readonly deepThinking?: string;
	readonly mode: { readonly axis: string; readonly value: string };
}

const ASKING_MODE = "default";

/** Thinking levels from least to most, as agy and the providers it fronts name them. */
const LEVELS = ["none", "off", "minimal", "lowest", "low", "medium", "high", "xhigh", "max"];

let chosen: Promise<CheapChoice> | undefined;

/** Chosen once per process from the first backend that asks; a choice that failed is made afresh by the next. */
export function cheapChoice(backend: AgentBackend, cwd: string): Promise<CheapChoice> {
	if (chosen !== undefined) return chosen;
	const choosing = choose(backend, cwd);
	chosen = choosing;
	choosing.catch(() => {
		if (chosen === choosing) chosen = undefined;
	});
	return choosing;
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

function thinkingOf(model: ModelSummary): Pick<CheapChoice, "thinking" | "deepThinking"> {
	const values = model.thinking.options.map((option) => option.value);
	if (values.length === 0) return {};
	const ranked = values.filter((value) => LEVELS.includes(value.toLowerCase()));
	ranked.sort((a, b) => LEVELS.indexOf(a.toLowerCase()) - LEVELS.indexOf(b.toLowerCase()));
	const [lowest] = ranked;
	const highest = ranked.at(-1);
	if (lowest === undefined || highest === undefined || ranked.length !== values.length) {
		throw new Error(`how the thinking levels of ${model.id} rank is not known: ${values.join(", ")}`);
	}
	return { thinking: lowest, deepThinking: highest };
}
