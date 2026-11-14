/**
 * The Claude Code adapter as the bridge registers it (adapter README D3): the user's `claude` the resolver finds, the
 * CLI version the pinned SDK was released with, the bridge's login-shell environment, `~/.broski/claude-code` for its
 * own state and the terminal hook's receiver (D29).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import sdkPackage from "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json";
import { type CliLocation, claudeCodeBackendFactory } from "../backends/claude-code/factory";
import type { TerminalAskHandler } from "../backends/claude-code/ports";
import type { BackendFactory } from "../contract";
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
}

export function claudeCodeBackend(deps: ClaudeCodeBackendDeps): BackendFactory {
	return async (host) =>
		claudeCodeBackendFactory({
			cli: cliLocation(deps.cli()),
			env: (deps.env ?? processEnv)(),
			stateDir: deps.stateDir ?? join(homedir(), ".broski", "claude-code"),
			clientApp: `broski/${deps.version}`,
			expectedCliVersion: EXPECTED_CLAUDE_CLI_VERSION,
			terminal: deps.hookAsks === undefined ? {} : { hookAsks: deps.hookAsks },
		})(host);
}

function cliLocation(found: ClaudeCliPath): CliLocation {
	return found.ok ? { found: true, path: found.path } : { found: false, reason: found.reason };
}

function processEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
	return env;
}
