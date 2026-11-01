/** Lane B · D31: a turn's outcome by `terminal_reason` first; a refusal is an error, never `completed`. */

import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunOutcome } from "../../../contract";

export function turnOutcome(_result: SDKResultMessage): RunOutcome {
	return { kind: "error", error: { code: "unknown", message: "not built yet: lane B turnOutcome" } };
}
