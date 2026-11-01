/** `AgentBackend.call`: Claude Code's own ops (`ClaudeCodeOp`), each to its file in `ops/`; another backend's is `unsupported`. */

import type { BackendCall, BackendCallResult } from "../../contract";
import { changedFiles } from "./ops/changed-files";
import { configFile } from "./ops/config-file";
import { configFiles } from "./ops/config-files";
import { contextUsage } from "./ops/context-usage";
import { customTool } from "./ops/custom-tool";
import { customTools } from "./ops/custom-tools";
import { mcpServers } from "./ops/mcp-servers";
import { plugins } from "./ops/plugins";
import { refreshModels } from "./ops/refresh-models";
import { rewindFiles } from "./ops/rewind-files";
import { sessionSettings } from "./ops/session-settings";
import { settingsOverview } from "./ops/settings-overview";
import { tasks } from "./ops/tasks";
import type { OpsDeps } from "./ports";
import { rejected } from "./rejections";

export async function callOp(deps: OpsDeps, call: BackendCall): Promise<BackendCallResult> {
	if (call.backend !== "claude-code")
		return rejected("unsupported", `Claude Code has no ${call.backend} op ${call.op.kind}`);
	const { op } = call;
	switch (op.kind) {
		case "rewind_files":
			return rewindFiles(deps, op);
		case "session_settings":
			return sessionSettings(deps, op);
		case "changed_files":
			return changedFiles(deps, op);
		case "refresh_models":
			return refreshModels(deps, op);
		case "config_files":
			return configFiles(deps, op);
		case "config_file":
			return configFile(deps, op);
		case "settings_overview":
			return settingsOverview(deps, op);
		case "mcp_servers":
			return mcpServers(deps, op);
		case "plugins":
			return plugins(deps, op);
		case "tasks":
			return tasks(deps, op);
		case "context_usage":
			return contextUsage(deps, op);
		case "custom_tools":
			return customTools(deps, op);
		case "custom_tool":
			return customTool(deps, op);
	}
}
