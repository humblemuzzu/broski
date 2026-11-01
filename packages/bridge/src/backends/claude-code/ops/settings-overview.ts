/** Lane F · `settingsOverview`: `resolveSettings()` with provenance as an `ActionList`, read-only (D22). */

import type { BackendCallResult, SettingsOverviewOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function settingsOverview(_deps: OpsDeps, _op: SettingsOverviewOp): Promise<BackendCallResult> {
	return notBuilt("lane F: settingsOverview");
}
