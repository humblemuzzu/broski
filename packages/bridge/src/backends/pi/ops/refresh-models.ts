/**
 * `refresh_models`: `pi update --models` from the phone. The adapter already re-reads `auth.json`, `models.json` and
 * `models-store.json` when one changes (`config-watch.ts`); what only a person asks for is fetching the catalogues from
 * the network, since a provider's new models appear in no file until then.
 */

import type { BackendCallResult } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import type { ModelRuntimeHost } from "../models/model-runtime";

export async function refreshModels(deps: {
	readonly models: Pick<ModelRuntimeHost, "refreshFromNetwork">;
	readonly catalog: Pick<CatalogFeed, "emit">;
}): Promise<BackendCallResult> {
	const problems = await deps.models.refreshFromNetwork();
	deps.catalog.emit({ type: "catalog_invalidated", scope: "models" });
	return { status: "accepted", result: { kind: "refresh_models", problems } };
}
