import { rejected } from "../../../adapter-kit/rejections";
import type { NewSessionOptions, Rejected } from "../../../contract";
import { isDirectory } from "../is-directory";
import type { ModelCatalogue } from "../models/catalogue";
import { supportedLevel } from "../models/thinking";
import { modeProblem } from "../modes";

/** The level a new session is set to once its `pi` runs, when the phone asked for one. */
export interface ModelChoice {
	readonly thinking?: string;
}

/**
 * What a new session asks for, checked before anything is written or started for it: its modes, its directory, the model
 * it names, and the level, against that model or, with none named, the one a new session in the directory starts on.
 */
export async function chooseModel(
	options: NewSessionOptions,
	models: Pick<ModelCatalogue, "find" | "missing" | "starting">,
): Promise<ModelChoice | Rejected> {
	for (const setting of options.modes ?? []) {
		const problem = modeProblem(setting);
		if (problem) return problem;
	}
	if (!isDirectory(options.cwd)) return rejected("invalid_input", `${options.cwd} is not a directory`);
	const model = options.modelId === undefined ? undefined : await models.find(options.modelId, options.cwd);
	if (options.modelId !== undefined && model === undefined) return models.missing(options.modelId);
	if (options.thinking === undefined) return {};
	const target = model ?? (await models.starting(options.cwd));
	if (target === undefined || supportedLevel(target, options.thinking) === undefined) {
		return rejected("invalid_input", `${target?.name ?? "the model"} offers no thinking level ${options.thinking}`);
	}
	return { thinking: options.thinking };
}
