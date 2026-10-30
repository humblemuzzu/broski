/**
 * A model's wire id is `${provider}/${id}` (D9), Pi's own way of naming a model. Ids may themselves hold `/`
 * (OpenRouter's `anthropic/claude-…`), so a wire id is never split: it is looked up in the table it was listed from.
 * Pi does not forbid `/` in a provider id either, and `a` + `b/c` would name the same model as `a/b` + `c`; so a
 * provider's `%` and `/` are written `%25` and `%2F`. Its part then holds no `/`, and no two models share a wire id.
 * A provider without either character, every one Pi ships, keeps the id Pi itself shows.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { MAX_CATALOG_ITEMS, MAX_ID_CHARS, type ModelId } from "../../../contract";

export interface ModelKey {
	readonly provider: string;
	readonly id: string;
}

export function modelWireId(model: ModelKey): ModelId {
	return `${model.provider.replaceAll("%", "%25").replaceAll("/", "%2F")}/${model.id}`;
}

/** Whether `model`'s wire id fits a `ModelId`; a model whose id does not is never listed. */
export function hasWireId(model: ModelKey): boolean {
	return model.provider.length > 0 && model.id.length > 0 && modelWireId(model).length <= MAX_ID_CHARS;
}

/** The models of the latest listing, by wire id. Replaced whole by each listing, so it stays bounded. */
export class ModelTable {
	private byWireId = new Map<ModelId, Model<Api>>();

	/** Keeps the first `MAX_CATALOG_ITEMS` models with a wire id; a model listed twice is kept once. */
	replace(models: readonly Model<Api>[]): void {
		const next = new Map<ModelId, Model<Api>>();
		for (const model of models) {
			if (next.size >= MAX_CATALOG_ITEMS) break;
			const wireId = modelWireId(model);
			if (hasWireId(model) && !next.has(wireId)) next.set(wireId, model);
		}
		this.byWireId = next;
	}

	get(wireId: ModelId): Model<Api> | undefined {
		return this.byWireId.get(wireId);
	}

	models(): Model<Api>[] {
		return [...this.byWireId.values()];
	}
}
