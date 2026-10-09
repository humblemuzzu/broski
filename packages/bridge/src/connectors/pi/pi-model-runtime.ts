import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import type { Model } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiModelPayload } from "../../types/pi";

let modelRuntime: ModelRuntime | null = null;
let creating: Promise<ModelRuntime> | null = null;
let oauthFlowsRegistered = false;

function registerOAuthFlowsOnce(): void {
	if (oauthFlowsRegistered) return;
	oauthFlowsRegistered = true;
	registerBunOAuthFlows();
}

async function createModelRuntime(): Promise<ModelRuntime> {
	registerOAuthFlowsOnce();
	try {
		modelRuntime = await ModelRuntime.create();
		return modelRuntime;
	} catch (error) {
		creating = null;
		throw error;
	}
}

/** Shared Pi model/auth runtime (auth.json + models.json under the agent dir). */
export function ensurePiModelRuntime(): Promise<ModelRuntime> {
	if (modelRuntime) return Promise.resolve(modelRuntime);
	creating ??= createModelRuntime();
	return creating;
}

function requirePiModelRuntime(): ModelRuntime {
	if (!modelRuntime) throw new Error("Pi model runtime is not initialized");
	return modelRuntime;
}

export function logPiModelRuntimeErrors(runtime: ModelRuntime): void {
	const error = runtime.getError();
	if (error) console.warn(`[pi-model-runtime] ${error}`);
}

export function mapPiModel(model: Model<any>): PiModelPayload {
	const runtime = requirePiModelRuntime();
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		api: String(model.api),
		contextWindow: Number(model.contextWindow ?? 0),
		maxTokens: Number(model.maxTokens ?? 0),
		reasoning: Boolean(model.reasoning),
		input: Array.isArray(model.input) ? model.input.map((entry) => String(entry)) : ["text"],
		cost: {
			input: Number(model.cost?.input ?? 0),
			output: Number(model.cost?.output ?? 0),
			cacheRead: Number(model.cost?.cacheRead ?? 0),
			cacheWrite: Number(model.cost?.cacheWrite ?? 0),
		},
		authenticated: runtime
			.getAvailableSnapshot()
			.some((available) => available.id === model.id && available.provider === model.provider),
		isOAuth: runtime.isUsingOAuth(model.provider),
	};
}

export async function listAvailableModels(): Promise<PiModelPayload[]> {
	const runtime = await ensurePiModelRuntime();
	return [...runtime.getAvailableSnapshot()].map((model) => mapPiModel(model));
}

export async function listAllModels(): Promise<PiModelPayload[]> {
	const runtime = await ensurePiModelRuntime();
	return runtime.getModels().map((model) => mapPiModel(model));
}

export async function listConfiguredProviders(): Promise<string[]> {
	const runtime = await ensurePiModelRuntime();
	const credentials = await runtime.listCredentials();
	return credentials.map((credential) => credential.providerId);
}

export async function refreshModels(): Promise<void> {
	const runtime = await ensurePiModelRuntime();
	await runtime.refresh();
}

export async function findModel(provider: string, modelId: string): Promise<Model<any> | undefined> {
	const runtime = await ensurePiModelRuntime();
	return runtime.getModel(provider, modelId);
}
