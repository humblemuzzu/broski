/**
 * The bridge's one Pi model/auth runtime, kept current.
 *
 * Pi's catalogue is not a constant: `models-store.json` (the pi.dev catalog cache `pi update --models`
 * writes), `models.json` (custom providers) and `auth.json` (which providers are usable) all change under
 * a long-running bridge. `ModelRuntime.refresh()` re-reads all three without the network, so every model
 * listing refreshes first and never serves the catalogue of a bridge that started days ago.
 */

import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadPiAiBunOAuth } from "../../sdk/pi-ai";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import type { PiModelPayload } from "../../types/pi";

type CachedRuntime = { agentDir: string; runtime: ModelRuntime };

let cached: CachedRuntime | null = null;
let creating: { agentDir: string; promise: Promise<ModelRuntime> } | null = null;
let refreshing: Promise<unknown> = Promise.resolve();
let oauthFlowsRegistered = false;

async function registerOAuthFlowsOnce(): Promise<void> {
	if (oauthFlowsRegistered) return;
	oauthFlowsRegistered = true;
	const { registerBunOAuthFlows } = await loadPiAiBunOAuth();
	registerBunOAuthFlows();
}

async function agentDirOf(): Promise<string> {
	const { getAgentDir } = await loadPiCodingAgent();
	return getAgentDir();
}

async function createModelRuntime(agentDir: string): Promise<ModelRuntime> {
	await registerOAuthFlowsOnce();
	const { ModelRuntime } = await loadPiCodingAgent();
	try {
		const runtime = await ModelRuntime.create();
		cached = { agentDir, runtime };
		return runtime;
	} finally {
		creating = null;
	}
}

/** Shared Pi model/auth runtime for the current agent dir (auth.json + models.json + models-store.json). */
export async function ensurePiModelRuntime(): Promise<ModelRuntime> {
	const agentDir = await agentDirOf();
	if (cached?.agentDir === agentDir) return cached.runtime;
	if (creating?.agentDir === agentDir) return creating.promise;
	const promise = createModelRuntime(agentDir);
	creating = { agentDir, promise };
	return promise;
}

function requirePiModelRuntime(): ModelRuntime {
	if (!cached) throw new Error("Pi model runtime is not initialized");
	return cached.runtime;
}

/**
 * Re-reads Pi's model configuration, one refresh at a time so concurrent listings cannot interleave.
 * `network` is what the CLI's `pi update --models` does (and what the app's refresh button triggers);
 * without it nothing goes over the wire and the on-disk catalogue is used as it is.
 */
export function refreshPiModelRuntime(options: { network?: boolean } = {}): Promise<void> {
	const network = options.network === true;
	const next = refreshing.then(async () => {
		const runtime = await ensurePiModelRuntime();
		await runtime.refresh({ allowNetwork: network });
	});
	refreshing = next.catch(() => undefined);
	return next;
}

export function logPiModelRuntimeErrors(runtime: ModelRuntime): void {
	const error = runtime.getError();
	if (error) console.warn(`[pi-model-runtime] ${error}`);
}

export function mapPiModel(model: Model<any>, authenticated?: boolean): PiModelPayload {
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
		authenticated:
			authenticated ??
			runtime
				.getAvailableSnapshot()
				.some((available) => available.id === model.id && available.provider === model.provider),
		isOAuth: runtime.isUsingOAuth(model.provider),
	};
}

/** A stale list beats no list, so a failed refresh is logged and the last good catalogue is served. */
async function refreshQuietly(runtime: ModelRuntime): Promise<void> {
	try {
		await refreshPiModelRuntime();
	} catch (error) {
		console.warn(`[pi-model-runtime] refresh failed: ${String(error)}`);
	}
	logPiModelRuntimeErrors(runtime);
}

/** The models Pi can run here right now: what `pi --list-models` prints. */
export async function availableModels(): Promise<readonly Model<Api>[]> {
	const runtime = await ensurePiModelRuntime();
	await refreshQuietly(runtime);
	return runtime.getAvailable();
}

/** Every model Pi knows, including providers whose credentials are missing. */
export async function allCatalogueModels(): Promise<readonly Model<Api>[]> {
	const runtime = await ensurePiModelRuntime();
	return runtime.getModels();
}

/** The models Pi can actually run here: the list `pi --list-models` prints. */
export async function listAvailableModels(): Promise<PiModelPayload[]> {
	return (await availableModels()).map((model) => mapPiModel(model, true));
}

export async function listAllModels(): Promise<PiModelPayload[]> {
	const available = new Set((await availableModels()).map((model) => `${model.provider}/${model.id}`));
	return (await allCatalogueModels()).map((model) => mapPiModel(model, available.has(`${model.provider}/${model.id}`)));
}

export async function listConfiguredProviders(): Promise<string[]> {
	const runtime = await ensurePiModelRuntime();
	const credentials = await runtime.listCredentials();
	return credentials.map((credential) => credential.providerId);
}

/** Fetches newer catalogs the way `pi update --models` does; only ever runs because the user asked. */
export async function refreshModels(): Promise<void> {
	await refreshPiModelRuntime({ network: true });
}

export async function findModel(provider: string, modelId: string): Promise<Model<any> | undefined> {
	const runtime = await ensurePiModelRuntime();
	return runtime.getModel(provider, modelId);
}
