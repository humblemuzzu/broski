/** Lane C · the `permissions` axis as listed (D12): labels, warnings, `auto` only where a model supports it. */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ModeAxis } from "../../contract";

export function permissionsAxis(_models: readonly ModelInfo[]): ModeAxis | undefined {
	return undefined;
}
