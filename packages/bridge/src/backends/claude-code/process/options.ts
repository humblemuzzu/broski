/** Lane D · D5: the `Options` of every host, with D4's env and the executable from `services.cli`. */

import type {
	CanUseTool,
	McpServerConfig,
	OnElicitation,
	Options,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { Rejected } from "../../../contract";
import { notBuilt } from "../rejections";
import type { ClaudeCodeServices } from "../services";

export interface HostOptionsInput {
	readonly services: ClaudeCodeServices;
	readonly cwd: string;
	readonly start: { readonly sessionId: string } | { readonly resume: string };
	readonly permissionMode: PermissionMode;
	readonly model?: string;
	readonly canUseTool: CanUseTool;
	readonly onElicitation: OnElicitation;
	readonly mcpServers: Record<string, McpServerConfig>;
}

/** `backend_error` when `services.cli` found no binary. */
export function hostOptions(_input: HostOptionsInput): Options | Rejected {
	return notBuilt("lane D: hostOptions");
}
