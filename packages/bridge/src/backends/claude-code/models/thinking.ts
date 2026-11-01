/** Lane C · a model's `ThinkingSpec`: its `supportedEffortLevels` as given (D11). */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ThinkingSpec } from "../../../contract";

export function thinkingSpec(_model: ModelInfo): ThinkingSpec {
	return { options: [] };
}
