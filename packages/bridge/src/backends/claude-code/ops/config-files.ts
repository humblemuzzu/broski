/** Lane F · `configFiles`: the CLI's own config files for a cwd (D22), managed ones read-only. */

import type { BackendCallResult, ConfigFilesOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function configFiles(_deps: OpsDeps, _op: ConfigFilesOp): Promise<BackendCallResult> {
	return notBuilt("lane F: configFiles");
}
