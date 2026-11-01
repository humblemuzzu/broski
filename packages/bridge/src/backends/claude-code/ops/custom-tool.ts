/** Lane F · `customTool`: one custom tool definition as JSON text, under `config_file`'s rules (D30). */

import type { BackendCallResult, CustomToolOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function customTool(_deps: OpsDeps, _op: CustomToolOp): Promise<BackendCallResult> {
	return notBuilt("lane F: customTool");
}
