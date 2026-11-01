/** Lane F · `contextUsage`: `getContextUsage({detail: "summary"})` as rows, total in `note` (D22). */

import type { BackendCallResult, ContextUsageOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function contextUsage(_deps: OpsDeps, _op: ContextUsageOp): Promise<BackendCallResult> {
	return notBuilt("lane F: contextUsage");
}
