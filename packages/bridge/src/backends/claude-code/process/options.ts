/** The `Options` of every host (D5), with the CLI's env (D4) and the user's executable (D3). */

import type { CanUseTool, EffortLevel, OnElicitation, Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected } from "../../../contract";
import type { BridgeMcpServer, ClaudeCodeServices } from "../services";

export interface HostOptionsInput {
	readonly services: ClaudeCodeServices;
	readonly cwd: string;
	readonly start: { readonly sessionId: string } | { readonly resume: string };
	readonly permissionMode: PermissionMode;
	readonly model?: string;
	readonly effort?: EffortLevel;
	readonly canUseTool: CanUseTool;
	readonly onElicitation: OnElicitation;
	readonly mcpServer?: BridgeMcpServer;
}

/**
 * The server sent in the initialize request, so its token stays off the command line; always loaded, so tool search
 * never defers it; and its one tool allowed without a permission ask.
 */
function mcpOptions(server: BridgeMcpServer): Pick<Options, "mcpServers" | "mcpServersDelivery" | "allowedTools"> {
	return {
		mcpServers: {
			[server.name]: {
				type: "http",
				url: server.url,
				headers: { authorization: `Bearer ${server.token}` },
				alwaysLoad: true,
			},
		},
		mcpServersDelivery: "initialize",
		allowedTools: [`mcp__${server.name}__broski_notify`],
	};
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
		forwardSubagentText: true,
		agentProgressSummaries: true,
		systemPrompt: {
			type: "preset",
			preset: "claude_code",
			...(services.appendSystemPrompt !== undefined && { append: services.appendSystemPrompt }),
		},
		canUseTool: input.canUseTool,
		onElicitation: input.onElicitation,
		...("sessionId" in input.start ? { sessionId: input.start.sessionId } : { resume: input.start.resume }),
		...(input.model !== undefined && { model: input.model }),
		...(input.effort !== undefined && { effort: input.effort }),
		...(input.mcpServer !== undefined && mcpOptions(input.mcpServer)),
	};
}
