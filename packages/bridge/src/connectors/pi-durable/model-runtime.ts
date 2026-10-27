import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import { readPiModelCatalogue } from "../pi/pi-model-catalogue";
import { ensurePiModelRuntime } from "../pi/pi-model-runtime";

export type PiDurableModelAccess = {
	models: Models;
	isSubscription: (providerId: string) => boolean;
};

export type PiDurableModelChoice = ModelRef & {
	label: string;
	contextWindow: number;
	supportsReasoning: boolean;
	/** The model's place in the user's own `enabledModels`, when they picked it. */
	selectedOrder?: number;
	isDefault?: boolean;
};

/** The one Pi `ModelRuntime` per bridge process, reused as `HarnessOptions.models` for every pi-durable session. */
export async function sharedPiDurableModelAccess(): Promise<PiDurableModelAccess> {
	const runtime = await ensurePiModelRuntime();
	return {
		models: runtime,
		isSubscription: (providerId) => runtime.isUsingSubscription(providerId),
	};
}

/**
 * The same catalogue and the same `enabledModels` the Pi backend serves: the user's own models first, in their
 * order, then everything else Pi can run here.
 */
export async function listPiDurableModels(): Promise<PiDurableModelChoice[]> {
	const catalogue = await readPiModelCatalogue();
	const defaultRef =
		catalogue.defaultModel === null
			? undefined
			: `${catalogue.defaultModel.provider}/${catalogue.defaultModel.modelId}`;
	const byRef = new Map(catalogue.data.map((model) => [`${model.provider}/${model.id}`, model]));

	const chosen: PiDurableModelChoice[] = [];
	for (const [order, entry] of catalogue.selected.entries()) {
		if (!entry.available || entry.provider === null || entry.modelId === null) continue;
		const ref = `${entry.provider}/${entry.modelId}`;
		const model = byRef.get(ref);
		if (model === undefined) continue;
		byRef.delete(ref);
		chosen.push({ ...choiceOf(model), selectedOrder: order, isDefault: ref === defaultRef });
	}

	return [...chosen, ...[...byRef.values()].map((model) => choiceOf(model))];
}

export async function resolvePiDurableModel(
	provider: string,
	modelId: string,
): Promise<PiDurableModelChoice | undefined> {
	const runtime = await ensurePiModelRuntime();
	const model = runtime.getModel(provider, modelId);
	if (model === undefined) return undefined;
	return choiceOf({
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
	});
}

type ModelFacts = {
	id: string;
	name: string;
	provider: string;
	contextWindow?: number;
	reasoning?: boolean;
};

function choiceOf(model: ModelFacts): PiDurableModelChoice {
	return {
		provider: model.provider,
		modelId: model.id,
		label: model.name || model.id,
		contextWindow: Number(model.contextWindow ?? 0),
		supportsReasoning: Boolean(model.reasoning),
	};
}
