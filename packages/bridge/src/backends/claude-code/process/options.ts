/** D5: the `Options` of every host, with D4's env (`services.cliEnv`) and the executable from `services.cli`. */

import type {
	CanUseTool,
	EffortLevel,
	McpServerConfig,
	OnElicitation,
	Options,
	PermissionMode,
} from "@anthropic-ai/claude-agent-sdk";
import type { Rejected } from "../../../contract";
import { rejected } from "../rejections";
import type { ClaudeCodeServices } from "../services";

export interface HostOptionsInput {
	readonly services: ClaudeCodeServices;
	readonly cwd: string;
	readonly start: { readonly sessionId: string } | { readonly resume: string };
	readonly permissionMode: PermissionMode;
	readonly model?: string;
	readonly effort?: EffortLevel;
	readonly canUseTool: CanUseTool;
	readonly onElicitation: OnElicitation;
	readonly mcpServers: Record<string, McpServerConfig>;
	readonly promptSuggestions?: boolean;
}

/** `backend_error` when `services.cli` found no binary. */
export function hostOptions(input: HostOptionsInput): Options | Rejected {
	const { services } = input;
	if (!services.cli.found) return rejected("backend_error", `Claude Code is not available: ${services.cli.reason}`);
	return {
		cwd: input.cwd,
		env: { ...services.cliEnv },
		pathToClaudeCodeExecutable: services.cli.path,
		permissionMode: input.permissionMode,
		...(services.mayBypassPermissions && { allowDangerouslySkipPermissions: true }),
		includePartialMessages: true,
		includeHookEvents: true,
		forwardSubagentText: true,
		agentProgressSummaries: true,
		enableFileCheckpointing: true,
		systemPrompt: { type: "preset", preset: "claude_code" },
		canUseTool: input.canUseTool,
		onElicitation: input.onElicitation,
		mcpServers: input.mcpServers,
		...("sessionId" in input.start ? { sessionId: input.start.sessionId } : { resume: input.start.resume }),
		...(input.model !== undefined && { model: input.model }),
		...(input.effort !== undefined && { effort: input.effort }),
		...(input.promptSuggestions === true && { promptSuggestions: true }),
	};
}
