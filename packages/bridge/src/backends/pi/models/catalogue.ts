import type { Api, Model } from "@earendil-works/pi-ai";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { MAX_NAME_CHARS, type ModelId, type ModelSummary, type ModelsListResult } from "../../../contract";
import { clipStart } from "../bounds";
import { rowText } from "../phone-text";
import { settingsOf } from "../project-settings";
import { rejected } from "../rejections";
import { ModelTable, modelWireId } from "./model-ids";
import type { ModelRuntimeHost } from "./model-runtime";
import { thinkingSpec } from "./thinking";

const sameModel = (model: Model<Api>) => `${model.provider}\0${model.id}`;

export class ModelCatalogue {
	constructor(
		private readonly host: ModelRuntimeHost,
		private readonly agentDir: string,
	) {}

	/** `cwd` picks the project settings the default model and the user's `enabledModels` come from. */
	async list(cwd: string | undefined): Promise<ModelsListResult> {
		const { models, error } = await this.host.available();
		if (models.length === 0 && error !== undefined) {
			return rejected("backend_error", `Pi could not list its models: ${error}`);
		}
		const settings = settingsOf(cwd, this.agentDir);
		const table = new ModelTable();
		table.replace(await this.scopedFirst(models, settings));
		return { status: "accepted", models: table.models().map((model) => this.summaryOf(model, settings)) };
	}

	/** The model a wire id names, if the runtime can run it now. */
	async find(id: ModelId): Promise<Model<Api> | undefined> {
		const table = new ModelTable();
		table.replace((await this.host.available()).models);
		return table.get(id);
	}

	/** The scope only orders the list, so a failure to resolve it must not hide the models; its diagnostics have no carrier (README). */
	private async scopedFirst(models: readonly Model<Api>[], settings: SettingsManager): Promise<Model<Api>[]> {
		const patterns = settings.getEnabledModels();
		if (patterns === undefined || patterns.length === 0) return [...models];
		try {
			const { scopedModels } = await this.host.scope(patterns);
			const listed = new Map(models.map((model) => [sameModel(model), model]));
			const scoped = scopedModels.flatMap(({ model }) => listed.get(sameModel(model)) ?? []);
			const taken = new Set(scoped.map(sameModel));
			return [...scoped, ...models.filter((model) => !taken.has(sameModel(model)))];
		} catch {
			return [...models];
		}
	}

	private summaryOf(model: Model<Api>, settings: SettingsManager): ModelSummary {
		const providerName = rowText(this.host.runtime.getProvider(model.provider)?.name ?? "");
		const defaultLevel = settings.getModelThinkingLevel(model.provider, model.id) ?? settings.getDefaultThinkingLevel();
		return {
			id: modelWireId(model),
			displayName: rowText(model.name) || clipStart(model.id, MAX_NAME_CHARS),
			providerId: model.provider,
			...(providerName !== "" && { providerName }),
			...(Number.isInteger(model.contextWindow) && model.contextWindow > 0 && { contextWindow: model.contextWindow }),
			inputModalities: [...new Set(model.input)],
			thinking: thinkingSpec(model, defaultLevel),
			isDefault: settings.getDefaultProvider() === model.provider && settings.getDefaultModel() === model.id,
		};
	}
}
