/** Lane E · `canUseTool` as `tool_permission` (D13): once/deny always present, one option per suggestion, deny-and-stop. */

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ToolPermissionReply, ToolPermissionRequest } from "../../../contract";

export type PermissionAskOptions = Parameters<CanUseTool>[2];

export interface PermissionAsk {
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly options: PermissionAskOptions;
}

/** The request, and per option id the result it answers with (its `PermissionUpdate[]` stay here, never in the contract). */
export interface PermissionPrompt {
	readonly request: ToolPermissionRequest | undefined;
	readonly decide: (reply: ToolPermissionReply) => PermissionResult | undefined;
}

export function permissionPrompt(_ask: PermissionAsk): PermissionPrompt {
	return { request: undefined, decide: () => undefined };
}
