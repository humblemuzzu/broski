/** Lane F · `refreshModels`: re-runs the probe (D11: the list is built into the CLI) and emits `catalog_invalidated`. */

import type { BackendCallResult, RefreshModelsOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function refreshModels(_deps: OpsDeps, _op: RefreshModelsOp): Promise<BackendCallResult> {
	return notBuilt("lane F: refreshModels");
}
