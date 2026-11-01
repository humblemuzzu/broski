/** Lane C · the `CatalogueAccess` `backend.ts` builds: `initialize` answers by cwd, cached (D6), and what they list. */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type { BackendStatus, ModelId, ModelSummary, Rejected } from "../../../contract";
import type { CatalogueAccess } from "../ports/catalogue";
import type { CatalogueDeps } from "../ports/deps";
import { notBuilt } from "../rejections";
import { claudeCodeStatus } from "../status";

export function createCatalogue(deps: CatalogueDeps): CatalogueAccess {
	const no = (what: string) => notBuilt(`lane C: catalogue ${what}`);
	return {
		initialize: async (): Promise<SDKControlInitializeResponse | Rejected> => no("initialize"),
		observe: () => undefined,
		invalidate: () => undefined,
		models: async () => no("models"),
		commands: async () => no("commands"),
		modes: async () => no("modes"),
		model: async (): Promise<ModelSummary | Rejected | undefined> => no("model"),
		listedModelId: async (): Promise<ModelId | undefined> => undefined,
		status: (): Promise<BackendStatus> => claudeCodeStatus({ services: deps.services }),
	};
}
