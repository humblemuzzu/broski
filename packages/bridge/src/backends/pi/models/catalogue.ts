/**
 * `listModels` and the model a request names, from a directory's catalog (`catalog/`): the models Pi can run there now
 * (`get_available_models` lists `getAvailableSnapshot()`, pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:403-406`).
 * RPC names no model Pi knows but cannot run, nor why, so `includeUnavailable` adds nothing.
 */

import {
	MAX_NAME_CHARS,
	type ModelId,
	type ModelListOptions,
	type ModelSummary,
	type ModelsListResult,
	type Rejected,
} from "../../../contract";
import { clipStart } from "../bounds";
import type { PiCatalogs } from "../catalog/catalogs";
import type { Catalog } from "../catalog/probe";
import { rowText } from "../phone-text";
import { rejected } from "../rejections";
import type { PiModel } from "../rpc/replies";
import { ModelTable, modelWireId } from "./model-ids";
import { thinkingSpec } from "./thinking";

export class ModelCatalogue {
	constructor(private readonly catalogs: PiCatalogs) {}

	async list(cwd: string | undefined, _options: ModelListOptions = {}): Promise<ModelsListResult> {
		const read = await this.catalogs.read(cwd);
		if ("failure" in read) return rejected("backend_error", `Pi could not list its models: ${read.failure}`);
		return {
			status: "accepted",
			models: tableOf(read)
				.models()
				.map((model) => summaryOf(model, read)),
		};
	}

	/** The model a wire id names, if Pi can run it in `cwd` now. */
	async find(id: ModelId, cwd: string | undefined): Promise<PiModel | undefined> {
		const read = await this.catalogs.read(cwd);
		return "failure" in read ? undefined : tableOf(read).get(id);
	}

	/** The model a new session in `cwd` starts on. */
	async starting(cwd: string): Promise<PiModel | undefined> {
		const read = await this.catalogs.read(cwd);
		return "failure" in read ? undefined : read.model;
	}

	missing(id: ModelId): Rejected {
		return rejected("not_found", `Pi can run no model ${id} here`);
	}
}

function tableOf(catalog: Catalog): ModelTable {
	const table = new ModelTable();
	table.replace(catalog.models);
	return table;
}

/** The model a new session starts on is the default, at the level it starts at. */
function summaryOf(model: PiModel, catalog: Catalog): ModelSummary {
	const isDefault = catalog.model !== undefined && modelWireId(catalog.model) === modelWireId(model);
	const contextWindow = model.contextWindow;
	return {
		id: modelWireId(model),
		displayName: rowText(model.name) || clipStart(model.id, MAX_NAME_CHARS),
		providerId: clipStart(model.provider, MAX_NAME_CHARS),
		...(contextWindow !== undefined && Number.isSafeInteger(contextWindow) && contextWindow > 0 && { contextWindow }),
		...(model.input !== undefined && { inputModalities: [...new Set(model.input)].filter(isModality) }),
		thinking: thinkingSpec(model, isDefault ? catalog.thinking : undefined),
		isDefault,
	};
}

function isModality(value: string): value is "text" | "image" {
	return value === "text" || value === "image";
}
