/** Lane B · `usage_updated` from `result.modelUsage`/`total_cost_usd`, cumulative per process, never summed (fact 7). */

import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Usage } from "../../../contract";

export function usageOf(_result: SDKResultMessage): Usage | undefined {
	return undefined;
}
