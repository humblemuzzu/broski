/** Lane F · `plugins`: plugins by `enabledPlugins`, with a session's loaded/failed state; toggle + `reloadPlugins` (D22). */

import type { BackendCallResult, PluginsOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function plugins(_deps: OpsDeps, _op: PluginsOp): Promise<BackendCallResult> {
	return notBuilt("lane F: plugins");
}
