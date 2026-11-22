/** The catalogue: models, commands, modes and status, from `initialize` answers (D7). */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type {
	BackendStatus,
	CommandsListResult,
	ModelId,
	ModelListOptions,
	ModelSummary,
	ModelsListResult,
	ModesListResult,
	Rejected,
} from "../../../contract";

export interface CatalogueAccess {
	/** A host's answer, else the cache (memory, then `<stateDir>/catalog.json`, 24 h), else a probe. */
	initialize(cwd: string): Promise<SDKControlInitializeResponse | Rejected>;
	/** A host's own `initialize` refreshes its cwd's cache and is checked against the expected CLI version (D3). */
	observe(cwd: string, init: SDKControlInitializeResponse): void;
	/** Drops one cwd's cache, or all, and emits `catalog_invalidated`. */
	invalidate(cwd?: string): void;
	models(cwd: string | undefined, options?: ModelListOptions): Promise<ModelsListResult>;
	commands(cwd: string | undefined): Promise<CommandsListResult>;
	modes(cwd: string | undefined): Promise<ModesListResult>;
	/** Undefined for a model the list does not offer, which `setModel` refuses `not_found`. */
	model(cwd: string, modelId: ModelId): Promise<ModelSummary | Rejected | undefined>;
	/** The listed id a wire model (`init.model`) resolves from, through `ModelInfo.resolvedModel` (D12). */
	listedModelId(cwd: string, wireModel: string): Promise<ModelId | undefined>;
	/** The CLI's own `claude_code_version`: the newest answer's, else `cwd`'s; undefined when none is known. */
	cliVersion(cwd: string): Promise<string | undefined>;
	/** Never fails (contract `status()`). */
	status(): Promise<BackendStatus>;
}
