/** Lane F · `customTools`: the custom tools (D30) as an `ActionList`: test (output in `note`) and delete. */

import type { BackendCallResult, CustomToolsOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function customTools(_deps: OpsDeps, _op: CustomToolsOp): Promise<BackendCallResult> {
	return notBuilt("lane F: customTools");
}
