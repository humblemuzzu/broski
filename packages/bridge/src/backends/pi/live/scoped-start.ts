import { type Api, type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import type {
	ModelRuntime,
	ResolveModelScopeResult,
	ScopedModel,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface ScopedStart {
	readonly scopedModels: readonly ScopedModel[];
	/** The model a new session starts on when none was asked for, with the level its `enabledModels` pattern names. */
	readonly start?: ScopedModel;
	readonly warnings: readonly string[];
}

/**
 * The user's `enabledModels` for a session's cwd, as the terminal reads them when it starts one (pi-coding-agent
 * `src/main.ts:813-817`), and the model a new session takes from them (`:500-520`): the saved default when the scope
 * holds it, else the scope's first. `createAgentSession` alone would pick from every model (`src/core/sdk.ts:234-251`).
 */
export async function scopedStart(
	settings: SettingsManager,
	modelRuntime: ModelRuntime,
	scope: (patterns: readonly string[]) => Promise<ResolveModelScopeResult>,
	isNew: boolean,
): Promise<ScopedStart> {
	const patterns = settings.getEnabledModels();
	if (patterns === undefined || patterns.length === 0) return { scopedModels: [], warnings: [] };
	const { scopedModels, diagnostics } = await scope(patterns);
	const warnings = diagnostics.map((diagnostic) => `Warning: ${diagnostic.message}`);
	const first = scopedModels[0];
	if (!isNew || first === undefined) return { scopedModels, warnings };
	const saved = savedDefault(settings, modelRuntime);
	const savedInScope =
		saved === undefined ? undefined : scopedModels.find((scoped) => modelsAreEqual(scoped.model, saved));
	return { scopedModels, start: savedInScope ?? first, warnings };
}

function savedDefault(settings: SettingsManager, modelRuntime: ModelRuntime): Model<Api> | undefined {
	const provider = settings.getDefaultProvider();
	const id = settings.getDefaultModel();
	return provider && id ? modelRuntime.getModel(provider, id) : undefined;
}
