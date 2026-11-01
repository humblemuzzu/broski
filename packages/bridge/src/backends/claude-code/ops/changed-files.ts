/** Lane F · `changedFiles`: the files the session's tool calls changed, from its finished history. */

import type { BackendCallResult, ChangedFilesOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function changedFiles(_deps: OpsDeps, _op: ChangedFilesOp): Promise<BackendCallResult> {
	return notBuilt("lane F: changedFiles");
}
