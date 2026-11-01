/** Lane D · `setModel` (D11), `setThinking` = `applyFlagSettings({effortLevel})`, `setMode` (D12), reconciled with frames. */

import type { ActionResult, ModeAxisId, ModelId } from "../../../contract";
import { notBuilt } from "../rejections";

export class SessionSettings {
	async setModel(_modelId: ModelId): Promise<ActionResult> {
		return notBuilt("lane D: setModel");
	}

	async setThinking(_value: string): Promise<ActionResult> {
		return notBuilt("lane D: setThinking");
	}

	async setMode(_axis: ModeAxisId, _value: string): Promise<ActionResult> {
		return notBuilt("lane D: setMode");
	}
}
