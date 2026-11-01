/** Lane F · `tasks`: a session's background tasks (`HostView.tasks()`), with stop (`stopTask`) (D22). */

import type { BackendCallResult, TasksOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function tasks(_deps: OpsDeps, _op: TasksOp): Promise<BackendCallResult> {
	return notBuilt("lane F: tasks");
}
