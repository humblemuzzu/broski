/** Lane F · `configFile`: one config file, read or changed: revision compare-and-swap, strict JSON, atomic write (§8). */

import type { BackendCallResult, ConfigFileOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function configFile(_deps: OpsDeps, _op: ConfigFileOp): Promise<BackendCallResult> {
	return notBuilt("lane F: configFile");
}
