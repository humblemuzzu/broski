import type { Api, Model } from "@earendil-works/pi-ai";
import type { NewSessionOptions, Rejected } from "../../../contract";
import { isDirectory } from "../is-directory";
import type { ModelCatalogue } from "../models/catalogue";
import { supportedLevel } from "../models/thinking";
import { modeProblem } from "../modes";
import { rejected } from "../rejections";
import type { HostStart } from "./host-environment";

export interface ModelChoice {
	readonly settings: Pick<HostStart, "model" | "thinkingLevel">;
	/** A level asked for with no model named, checked against the model Pi picks once the session exists. */
	readonly thinkingAfterStart?: string;
}

/** What a new session asks for, checked before anything is written or built for it. */
export async function chooseModel(
	options: NewSessionOptions,
	models: Pick<ModelCatalogue, "find" | "missing">,
): Promise<ModelChoice | Rejected> {
	for (const setting of options.modes ?? []) {
		const problem = modeProblem(setting);
		if (problem) return problem;
	}
	if (!isDirectory(options.cwd)) return rejected("invalid_input", `${options.cwd} is not a directory`);
	if (options.modelId === undefined) {
		return options.thinking === undefined ? { settings: {} } : { settings: {}, thinkingAfterStart: options.thinking };
	}
	const model: Model<Api> | undefined = await models.find(options.modelId);
	if (!model) return models.missing(options.modelId);
	if (options.thinking === undefined) return { settings: { model } };
	const thinkingLevel = supportedLevel(model, options.thinking);
	if (thinkingLevel === undefined) {
		return rejected("invalid_input", `${model.name} offers no thinking level ${options.thinking}`);
	}
	return { settings: { model, thinkingLevel } };
}
