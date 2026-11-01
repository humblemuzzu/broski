/** Lane F · `rewindFiles`: D23: `rewindFiles` on the session's host (a transient one when it has none), `dryRun` first. */

import type { BackendCallResult, RewindFilesOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function rewindFiles(_deps: OpsDeps, _op: RewindFilesOp): Promise<BackendCallResult> {
	return notBuilt("lane F: rewindFiles");
}
