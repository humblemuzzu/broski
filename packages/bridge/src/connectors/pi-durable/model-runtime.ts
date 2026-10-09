import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import { ensurePiModelRuntime } from "../pi/pi-model-runtime";

export type PiDurableModelAccess = {
	models: Models;
	isSubscription: (providerId: string) => boolean;
};

export type PiDurableModelChoice = ModelRef & {
	label: string;
	contextWindow: number;
	supportsReasoning: boolean;
};

/** The one Pi `ModelRuntime` per bridge process, reused as `HarnessOptions.models` for every pi-durable session. */
export async function sharedPiDurableModelAccess(): Promise<PiDurableModelAccess> {
	const runtime = await ensurePiModelRuntime();
	return {
		models: runtime,
		isSubscription: (providerId) => runtime.isUsingSubscription(providerId),
	};
}

export async function listPiDurableModels(): Promise<PiDurableModelChoice[]> {
	const runtime = await ensurePiModelRuntime();
	return runtime.getAvailableSnapshot().map((model) => choiceOf(model.provider, model.id, model.name, model));
}

export async function resolvePiDurableModel(
	provider: string,
	modelId: string,
): Promise<PiDurableModelChoice | undefined> {
	const runtime = await ensurePiModelRuntime();
	const model = runtime.getModel(provider, modelId);
	if (model === undefined) return undefined;
	return choiceOf(model.provider, model.id, model.name, model);
}

function choiceOf(
	provider: string,
	modelId: string,
	label: string,
	model: { contextWindow?: number; reasoning?: boolean },
): PiDurableModelChoice {
	return {
		provider,
		modelId,
		label,
		contextWindow: Number(model.contextWindow ?? 0),
		supportsReasoning: Boolean(model.reasoning),
	};
}
