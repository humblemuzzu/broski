/** `refresh_models` (D11): the model list is built into the CLI, so refreshing drops the cached `initialize` answers. */

import type { BackendCallResult, RefreshModelsOp } from "../../../contract";
import type { OpsDeps } from "../ports";
import { guarded } from "./guard";

export async function refreshModels(deps: OpsDeps, _op: RefreshModelsOp): Promise<BackendCallResult> {
	return guarded("refresh_models", async () => {
		deps.catalogue.invalidate();
		return { kind: "refresh_models", problems: [] };
	});
}
