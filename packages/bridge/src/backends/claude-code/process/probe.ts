/** Lane C · a probe `query()` with an empty inbox: `initializationResult()`, then `close()` in `finally` (D6). */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type { Rejected } from "../../../contract";
import { notBuilt } from "../rejections";
import type { ClaudeCodeServices } from "../services";

export async function probeInitialize(
	_services: ClaudeCodeServices,
	_cwd: string,
): Promise<SDKControlInitializeResponse | Rejected> {
	return notBuilt("lane C: probeInitialize");
}
