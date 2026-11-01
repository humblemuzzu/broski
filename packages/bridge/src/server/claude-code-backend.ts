/**
 * The Claude Code adapter as the bridge registers it behind `claudeCode.contract` (PLAN D28): the CLI the one resolver
 * finds (D35), the CLI version this build carries (D3), the bridge's login-shell environment, `~/.broski/claude-code`
 * for its own state, the custom tools of `custom-tools.ts` (D30) and the terminal hook's receiver (D26).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import sdkPackage from "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json";
import { type CliLocation, claudeCodeBackendFactory } from "../backends/claude-code/factory";
import type { CustomToolsPort, TerminalAskHandler } from "../backends/claude-code/ports";
import { trashTargetOf } from "../backends/claude-code/trash";
import type { BackendFactory } from "../contract";
import * as customTools from "../custom-tools";
import { createCustomToolsPort } from "./cc-custom-tools";
import type { ClaudeCliPath } from "./claude-cli-path";

/** The CLI the SDK this build bundles was released with; a host's `initialize` is checked against it (D3). */
export const EXPECTED_CLAUDE_CLI_VERSION: string = sdkPackage.claudeCodeVersion;

export interface ClaudeCodeBackendDeps {
	readonly cli: () => ClaudeCliPath;
	readonly version: string;
	/** Read when the backend starts: the bridge's environment, the login shell's by then (`platform/shell-env.ts`). */
	readonly env?: () => Readonly<Record<string, string>>;
	readonly stateDir?: string;
	readonly hookAsks?: (handler: TerminalAskHandler) => void;
	readonly customTools?: CustomToolsPort;
}

export function claudeCodeBackend(deps: ClaudeCodeBackendDeps): BackendFactory {
	return async (host) => {
		const env = (deps.env ?? processEnv)();
		return claudeCodeBackendFactory({
			cli: cliLocation(deps.cli()),
			env,
			stateDir: deps.stateDir ?? join(homedir(), ".broski", "claude-code"),
			clientApp: `broski/${deps.version}`,
			expectedCliVersion: EXPECTED_CLAUDE_CLI_VERSION,
			customTools: deps.customTools ?? customToolsOf(env),
			terminal: deps.hookAsks === undefined ? {} : { hookAsks: deps.hookAsks },
		})(host);
	};
}

function cliLocation(found: ClaudeCliPath): CliLocation {
	return found.ok ? { found: true, path: found.path, source: found.source } : { found: false, reason: found.reason };
}

function processEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
	return env;
}

function customToolsOf(env: Readonly<Record<string, string>>): CustomToolsPort {
	return createCustomToolsPort({
		store: {
			all: () => customTools.getCustomTools(),
			save: (tool) => customTools.saveCustomTool(tool),
			delete: (toolId) => customTools.deleteCustomTool(toolId),
			test: (tool) => customTools.testCustomTool(tool, {}),
			server: () => customTools.createCustomToolsServer(),
			newId: () => customTools.generateToolId(),
		},
		stagingDir: join(homedir(), ".broski", "claude-code", "trash-staging"),
		trash: () => trashTargetOf(env, new Date()),
	});
}
