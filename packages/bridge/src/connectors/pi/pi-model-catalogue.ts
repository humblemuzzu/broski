/**
 * Pi's model catalogue as the app offers it: every model Pi can run here, plus the list the user picked.
 *
 * Both halves come from the SDK, never from our own parsing of Pi's files: the catalogue is
 * `ModelRuntime.getAvailable()` — what `pi --list-models` prints and what the CLI's `/model` picker lists — and
 * the selection is `SettingsManager.getEnabledModels()` resolved by `resolveModelScopeWithDiagnostics()`, the
 * SDK's `enabledModels` / `--models` scope resolution, so `provider/id`, bare ids, globs and `:thinking`
 * suffixes all behave exactly as they do in the CLI.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import type {
	PiDefaultModelPayload,
	PiHiddenModelsPayload,
	PiModelPayload,
	PiSelectedModelPayload,
} from "../../types/pi";
import { findInCatalogue, hiddenModels, unavailableReason } from "./pi-model-availability";
import { availableModels, ensurePiModelRuntime, mapPiModel, refreshPiModelRuntime } from "./pi-model-runtime";

/** Pi's own default when neither the setting nor a per-model override names a level. */
const PI_DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

type CatalogModel = Model<Api>;
type ScopeResolver = typeof import("@earendil-works/pi-coding-agent").resolveModelScopeWithDiagnostics;

export type PiModelCatalogue = {
	/** Every model Pi offers here, exactly as `pi --list-models` prints it. */
	data: PiModelPayload[];
	/** `enabledModels` in the user's order; an entry nothing matches is one muted row carrying its pattern. */
	selected: PiSelectedModelPayload[];
	defaultModel: PiDefaultModelPayload | null;
	/** Models of the providers the user's own list names that no credential can run here. */
	hidden: PiHiddenModelsPayload;
};

function rowOf(pattern: string, model: CatalogModel, thinkingLevel: ThinkingLevel | undefined): PiSelectedModelPayload {
	return {
		pattern,
		label: model.name || model.id,
		name: model.name || model.id,
		provider: model.provider,
		modelId: model.id,
		thinkingLevel: thinkingLevel ?? null,
		available: true,
		unavailableReason: null,
	};
}

function unknownRow(pattern: string): PiSelectedModelPayload {
	return {
		pattern,
		label: pattern,
		name: null,
		provider: null,
		modelId: null,
		thinkingLevel: null,
		available: false,
		unavailableReason: "Not in Pi's catalogue",
	};
}

/**
 * A pattern `getAvailable()` matched nothing for still names something in the full catalogue: the model is
 * there, its provider is just not signed in. Keeping the real name lets us say which variable is missing.
 */
async function unavailableRows(pattern: string, runtime: ModelRuntime): Promise<PiSelectedModelPayload[]> {
	const matches = findInCatalogue(pattern, runtime.getModels());
	if (matches.length === 0) return [unknownRow(pattern)];

	return await Promise.all(
		matches.map(async ({ model, thinkingLevel }) => ({
			...rowOf(pattern, model, thinkingLevel ?? undefined),
			available: false,
			unavailableReason: await unavailableReason(runtime, model.provider),
		})),
	);
}

/** One `enabledModels` entry resolved the way the CLI resolves `--models`. */
async function selectionOf(
	pattern: string,
	runtime: ModelRuntime,
	scope: ScopeResolver,
): Promise<PiSelectedModelPayload[]> {
	const { scopedModels } = await scope([pattern], runtime);
	if (scopedModels.length === 0) return await unavailableRows(pattern, runtime);
	return scopedModels.map((scoped) => rowOf(pattern, scoped.model, scoped.thinkingLevel));
}

function effectiveLevel(
	settings: SettingsManager,
	provider: string,
	modelId: string,
	pinned: ThinkingLevel | null,
): ThinkingLevel {
	return (
		pinned ??
		settings.getModelThinkingLevel(provider, modelId) ??
		settings.getDefaultThinkingLevel() ??
		PI_DEFAULT_THINKING_LEVEL
	);
}

/**
 * The model a new session starts with, by Pi's own priority: the saved default, then the first model in scope,
 * then the first model Pi can run here.
 */
function defaultModelOf(
	settings: SettingsManager,
	available: readonly CatalogModel[],
	selected: readonly PiSelectedModelPayload[],
): PiDefaultModelPayload | null {
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const named =
		provider === undefined || modelId === undefined
			? undefined
			: available.find((model) => model.provider === provider && model.id === modelId);
	if (named !== undefined) {
		return {
			provider: named.provider,
			modelId: named.id,
			thinkingLevel: effectiveLevel(settings, named.provider, named.id, null),
		};
	}

	for (const row of selected) {
		if (!row.available || row.provider === null || row.modelId === null) continue;
		return {
			provider: row.provider,
			modelId: row.modelId,
			thinkingLevel: effectiveLevel(settings, row.provider, row.modelId, row.thinkingLevel),
		};
	}

	const first = available[0];
	if (first === undefined) return null;
	return {
		provider: first.provider,
		modelId: first.id,
		thinkingLevel: effectiveLevel(settings, first.provider, first.id, null),
	};
}

function dedupe(rows: readonly PiSelectedModelPayload[]): PiSelectedModelPayload[] {
	const seen = new Set<string>();
	return rows.filter((row) => {
		const key = row.provider === null ? `pattern:${row.pattern}` : `${row.provider}/${row.modelId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Reads Pi's live catalogue and the user's selection under `cwd`, refreshed from disk first. */
export async function readPiModelCatalogue(cwd?: string): Promise<PiModelCatalogue> {
	const available = await availableModels();
	const runtime = await ensurePiModelRuntime();
	const { SettingsManager, resolveModelScopeWithDiagnostics } = await loadPiCodingAgent();
	const settings = SettingsManager.create(cwd ?? process.cwd());

	const selected: PiSelectedModelPayload[] = [];
	for (const pattern of settings.getEnabledModels() ?? []) {
		selected.push(...(await selectionOf(pattern, runtime, resolveModelScopeWithDiagnostics)));
	}
	const rows = dedupe(selected);
	const selectedProviders = new Set(
		rows.map((row) => row.provider).filter((provider): provider is string => provider !== null),
	);

	const data = [...available]
		.sort((left, right) => left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id))
		.map((model) => mapPiModel(model, true));

	return {
		data,
		selected: rows,
		defaultModel: defaultModelOf(settings, available, rows),
		hidden: hiddenModels(runtime, available, runtime.getModels(), selectedProviders),
	};
}

/** Fetches newer catalogues over the network like `pi update --models`, then reads the result back. */
export async function refreshPiModelCatalogue(cwd?: string): Promise<PiModelCatalogue> {
	await refreshPiModelRuntime({ network: true });
	return readPiModelCatalogue(cwd);
}
